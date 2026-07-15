import type { BrowserWindow } from 'electron';
import { withDbAccess } from '../db';
import { getWatchTargets, type WatchTarget } from '../db/queries/games/getWatchTargets';
import { closeSession } from '../db/queries/sessions/closeSession';
import { getOpenSessions } from '../db/queries/sessions/getOpenSessions';
import { heartbeatSessions } from '../db/queries/sessions/heartbeatSessions';
import { startGameSession } from '../db/queries/sessions/startGameSession';

const POLL_INTERVAL_MS = 5000;

// Una sesión que el watcher tiene abierta ahora mismo.
type ActiveSession = { pid: number; sessionId: number; title: string };

// Un juego vigilado que está corriendo AHORA (verificado por ruta en la
// Fase 2). Es la "foto actual" que se compara contra `active`.
type RunningGame = { pid: number; title: string };

// SPEC sección 6/7 — el watcher vive en el main, observa los procesos del
// sistema cada ~5s (no lanza nada) y traduce arranques/cierres en sesiones
// automáticas. Enfoque de dos fases: barrido barato por nombre (ps-list) +
// verificación cara por ruta solo de los candidatos (find-process).
export class ProcessWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private reconciled = false;
  // Foto anterior: sesiones abiertas que el watcher sigue, indexadas por
  // gameId (SPEC 4.5: como mucho un playthrough activo por juego → una sesión
  // por juego). Sobrevive entre ciclos; NO se recalcula desde la DB.
  private readonly active = new Map<number, ActiveSession>();
  private readonly getWindow: () => BrowserWindow | null;
  // Bandeja del sistema (SPEC 6, opcional): deja ver de un vistazo qué se
  // está jugando sin abrir la ventana. Se llama con los títulos actualmente
  // en marcha cada vez que el conjunto puede haber cambiado.
  private readonly onActiveGamesChange?: (titles: string[]) => void;

  constructor(
    getWindow: () => BrowserWindow | null,
    onActiveGamesChange?: (titles: string[]) => void,
  ) {
    this.getWindow = getWindow;
    this.onActiveGamesChange = onActiveGamesChange;
  }

  start(): void {
    if (this.timer) return;
    // Solo ASCII en los console.log de este archivo a propósito — la consola
    // de VS Code en Windows no siempre usa la página de códigos UTF-8, y
    // cualquier acento o símbolo especial (▶, →, í...) sale con la
    // codificación rota. Un guion/flecha ASCII se ve bien en cualquier caso.
    console.log(`[watcher] iniciado - sondeo cada ${POLL_INTERVAL_MS / 1000}s`);
    // Primer sondeo inmediato para no esperar 5s tras arrancar la app.
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    // Un ciclo puede tardar más que el intervalo si find-process va lento (o
    // el sistema tiene muchos procesos) — evito que dos ciclos se solapen.
    if (this.polling) return;
    this.polling = true;

    try {
      // Los dos tramos que tocan la DB van dentro de withDbAccess() para no
      // pisarse con un swap de conexión en caliente (ver attemptSyncUpgrade
      // en db/index.ts). El scan() de procesos queda fuera a propósito: puede
      // tardar segundos y no toca la DB — no debe retener el candado.
      const targets = await withDbAccess(() => getWatchTargets());
      const running = await this.scan(targets);

      const changed = await withDbAccess(async () => {
        let changed = false;

        // La primera vuelta reconcilia las sesiones que quedaron abiertas de una
        // ejecución anterior o de un Play manual colgado.
        if (!this.reconciled) {
          this.reconciled = true;
          changed = (await this.reconcileOpenSessions(running)) || changed;
        }

        // Arranques: corriendo ahora y sin sesión que el watcher siga todavía.
        const untrackedGameIds = Array.from(running.keys()).filter(
          (gameId) => !this.active.has(gameId),
        );
        if (untrackedGameIds.length > 0) {
          // Alguno de estos puede tener YA una sesión abierta que el watcher
          // no esté siguiendo todavía — ej. el botón Play, que lanza el .exe
          // y abre su propia sesión automática (ver ActionBar/
          // startGameSession) antes de que este ciclo la vea. Sin esto,
          // startGameSession() de abajo la detectaría como "ya abierta" y
          // devolvería null (no se duplica) — pero sin quedar NUNCA en
          // `this.active`, así que su cierre no se detectaría jamás (la
          // sección de "Cierres" de más abajo solo mira `this.active`): había
          // que esperar SIEMPRE al botón Stop manual. Se ADOPTA en vez de
          // dejarla huérfana — misma idea que reconcileOpenSessions, pero
          // repetida en cada ciclo, no solo al arrancar la app.
          const openSessions = await getOpenSessions();
          for (const gameId of untrackedGameIds) {
            const info = running.get(gameId);
            if (!info) continue;

            const existingOpen = openSessions.find((session) => session.gameId === gameId);
            if (existingOpen) {
              this.active.set(gameId, {
                pid: info.pid,
                sessionId: existingOpen.sessionId,
                title: info.title,
              });
              console.log(
                `[watcher] [adopt] "${info.title}" (pid ${info.pid}) -> sesion ${existingOpen.sessionId}`,
              );
              continue;
            }

            // Deja el juego en "Playing" (creando/reanudando playthrough) y
            // cuelga la sesión.
            const session = await startGameSession(gameId);
            if (session) {
              this.active.set(gameId, { pid: info.pid, sessionId: session.id, title: info.title });
              console.log(
                `[watcher] [start] "${info.title}" (pid ${info.pid}) -> sesion ${session.id}`,
              );
              changed = true;
            }
          }
        }

        // Cierres: seguíamos una sesión y el juego ya no corre. Se cierra a la
        // hora actual (la detección es de ~5s, así que la duración es fiable).
        for (const [gameId, activeSession] of this.active) {
          if (running.has(gameId)) continue;

          await closeSession(activeSession.sessionId, new Date());
          this.active.delete(gameId);
          console.log(
            `[watcher] [stop] juego ${gameId} cerrado -> sesion ${activeSession.sessionId} cerrada`,
          );
          changed = true;
        }

        // Latido de las sesiones que siguen vivas: deja constancia en la DB de
        // que llegaron hasta aquí, para poder cerrarlas en este punto si la app
        // muere de golpe antes del próximo ciclo (corte de luz, cuelgue).
        await heartbeatSessions(
          Array.from(this.active.values(), (session) => session.sessionId),
          new Date(),
        );

        return changed;
      });

      if (changed) this.notifyRenderer();
      // Barato — solo lee el Map en memoria — así que se llama siempre, no
      // solo cuando `changed`: la reconciliación al arrancar puede adoptar un
      // juego que ya estaba en marcha sin que eso cuente como "cambio" (ver
      // reconcileOpenSessions), y el tooltip debe reflejarlo igual.
      this.onActiveGamesChange?.(this.getActiveTitles());
    } catch (error) {
      // Un fallo de un ciclo no debe tumbar el intervalo: se reintenta al
      // siguiente tick.
      console.error('[watcher] Error en el ciclo de sondeo:', error);
    } finally {
      this.polling = false;
    }
  }

  // Al arrancar puede haber sesiones abiertas de antes: la app se cerró con un
  // juego en marcha (cierre brusco / corte de luz), o quedó un Play manual sin
  // parar. Por cada una: si el juego está corriendo AHORA se adopta (para
  // cerrarla bien cuando muera); si no, ya no es válida y se cierra en su
  // último latido del watcher (`lastHeartbeatAt`) — así se conserva el tiempo
  // jugado hasta ~5s antes del corte, sin inflarlo con el hueco app-apagada.
  // Si nunca latió (sesión manual, o murió en el primer ciclo) se cae a
  // `startedAt` → duración 0, sin inventar horas que no se midieron.
  private async reconcileOpenSessions(running: Map<number, RunningGame>): Promise<boolean> {
    const openSessions = await getOpenSessions();
    let changed = false;

    for (const session of openSessions) {
      const runningGame = running.get(session.gameId);
      if (runningGame) {
        this.active.set(session.gameId, {
          pid: runningGame.pid,
          sessionId: session.sessionId,
          title: runningGame.title,
        });
      } else {
        const endedAt = session.lastHeartbeatAt ?? session.startedAt;
        await closeSession(session.sessionId, endedAt);
        console.log(
          `[watcher] [info] sesion ${session.sessionId} (juego ${session.gameId}) recuperada al arrancar - cerrada en su ultimo latido`,
        );
        changed = true;
      }
    }

    return changed;
  }

  // Fase 1 (barrido barato por nombre) + Fase 2 (verificación por ruta),
  // SPEC sección 7. Devuelve qué juegos vigilados están corriendo ahora.
  private async scan(targets: WatchTarget[]): Promise<Map<number, RunningGame>> {
    const running = new Map<number, RunningGame>();
    if (targets.length === 0) return running;

    // ps-list es ESM puro; find-process es dual pero expone su función como
    // `default`, y el interop estático de rollup (main empaquetado como CJS)
    // no lo resuelve bien → import dinámico para ambos, que sí da la función.
    const [{ default: psList }, { default: find }] = await Promise.all([
      import('ps-list'),
      import('find-process'),
    ]);
    const processes = await psList();

    const targetsByExeName = new Map<string, WatchTarget[]>();
    for (const target of targets) {
      const list = targetsByExeName.get(target.exeName) ?? [];
      list.push(target);
      targetsByExeName.set(target.exeName, list);
    }

    // Fase 1: candidatos por coincidencia de nombre de exe (lowercase). Barato
    // porque ps-list solo da nombre + pid de todo el sistema.
    const candidates: { pid: number; target: WatchTarget }[] = [];
    for (const proc of processes) {
      const matches = targetsByExeName.get(proc.name.toLowerCase());
      if (!matches) continue;
      for (const target of matches) candidates.push({ pid: proc.pid, target });
    }

    // Fase 2: verificación por ruta completa (cmd) solo de los candidatos.
    for (const { pid, target } of candidates) {
      // Ya confirmado por otro proceso con el mismo nombre: no repito find.
      if (running.has(target.gameId)) continue;
      try {
        const [detail] = await find('pid', pid);
        if (detail && detail.cmd.toLowerCase().includes(target.exePath)) {
          running.set(target.gameId, { pid, title: target.gameTitle });
        }
      } catch (error) {
        // El pid puede morir entre Fase 1 y 2, o find-process fallar en un
        // proceso protegido (anti-cheat) — no debe tumbar el resto del ciclo.
        console.warn(`[watcher] No se pudo verificar el pid ${pid}:`, error);
      }
    }

    return running;
  }

  private getActiveTitles(): string[] {
    return Array.from(this.active.values(), (session) => session.title);
  }

  private notifyRenderer(): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('games:changed');
    }
  }
}
