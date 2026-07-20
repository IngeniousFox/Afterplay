import type { BrowserWindow } from 'electron';
import { closeSync, openSync } from 'node:fs';
import { withDbAccess } from '../db';
import { getWatchTargets, type WatchTarget } from '../db/queries/games/getWatchTargets';
import { closeSession } from '../db/queries/sessions/closeSession';
import { createEmulatorSession } from '../db/queries/sessions/createEmulatorSession';
import { getOpenSessions, type OpenSession } from '../db/queries/sessions/getOpenSessions';
import { heartbeatSessions } from '../db/queries/sessions/heartbeatSessions';
import { startGameSession } from '../db/queries/sessions/startGameSession';

const POLL_INTERVAL_MS = 5000;

// ¿Está este .exe ejecutándose AHORA? — Windows bloquea contra escritura el
// archivo de imagen de todo proceso vivo, así que intentar abrirlo en
// lectura+escritura falla con EBUSY mientras corre y funciona en cuanto
// muere. Comprobación EXCEPCIONAL (Fase 2b): solo se consulta cuando la
// Fase 2 no ha podido leer la ruta del proceso (juegos con anti-cheat que
// bloquean la introspección vía WMI — caso real: Neverness to Everness).
// Con ruta legible, mande o no, este candado NI SE MIRA. Solo EBUSY cuenta
// como "corriendo" — un EACCES/EPERM es un problema de permisos de la
// carpeta (ej. Program Files sin elevar), no una señal de ejecución, y
// tratarlo como tal daría falsos positivos permanentes. La ruta viene en
// minúsculas (WatchTarget.exePath) — da igual, el sistema de archivos de
// Windows es insensible a mayúsculas.
const isExecutableBusy = (exePath: string): boolean => {
  try {
    closeSync(openSync(exePath, 'r+'));
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EBUSY';
  }
};

// Una sesión que el watcher tiene abierta ahora mismo.
type ActiveSession = { pid: number; sessionId: number; title: string };

// Un objetivo vigilado (juego o emulador) que está corriendo AHORA
// (verificado por ruta en la Fase 2). Es la "foto actual" que se compara
// contra `active`.
type RunningTarget = { pid: number; target: WatchTarget };

// La clave del mapa de sesiones activas para una sesión abierta de la DB —
// el mismo formato que WatchTarget.key ("game:12" / "emu:3"), o null si la
// sesión no tiene dueño reconocible (huérfana de un emulador borrado).
const openSessionKey = (session: OpenSession): string | null => {
  if (session.gameId !== null) return `game:${session.gameId}`;
  if (session.emulatorId !== null) return `emu:${session.emulatorId}`;
  return null;
};

// SPEC sección 6/7 + EMULADORES.md — el watcher vive en el main, observa los
// procesos del sistema cada ~5s (no lanza nada) y traduce arranques/cierres
// en sesiones automáticas. Enfoque de dos fases: barrido barato por nombre
// (ps-list) + verificación cara por ruta solo de los candidatos
// (find-process). Los emuladores usan EXACTAMENTE el mismo barrido — la
// única diferencia es qué se crea al detectar uno: una sesión sin juego
// asignado (createEmulatorSession) en vez de un playthrough activo.
export class ProcessWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private reconciled = false;
  // true mientras el PC está bloqueado o suspendido (powerMonitor, ver
  // main/index.ts). El sondeo se salta entero mientras tanto — nada de
  // escanear procesos ni de abrir sesiones nuevas — para que un juego que
  // sigue "corriendo" detrás de la pantalla de bloqueo no reabra sola una
  // sesión a los 5s de haberla cerrado por pausa.
  private paused = false;
  // Foto anterior: sesiones abiertas que el watcher sigue, indexadas por la
  // clave del objetivo ("game:12" / "emu:3" — SPEC 4.5: como mucho una
  // sesión abierta por juego, y el dedup de createEmulatorSession garantiza
  // lo mismo por emulador). Sobrevive entre ciclos; NO se recalcula desde
  // la DB.
  private readonly active = new Map<string, ActiveSession>();
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

  // PC bloqueado o suspendido (powerMonitor 'lock-screen'/'suspend'): cierra
  // YA todas las sesiones que se estén siguiendo (no esperar al próximo
  // sondeo) y deja de escanear hasta el resume/unlock. Cierra SIEMPRE que el
  // juego siga corriendo detrás del bloqueo — el tiempo con la pantalla
  // bloqueada no es tiempo jugado, esté el proceso vivo o no.
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    void this.closeAllActive('pause');
  }

  // 'resume'/'unlock-screen': sondeo inmediato en vez de esperar el próximo
  // tick (hasta 5s) — si el juego seguía corriendo detrás del bloqueo, se
  // retoma con una sesión nueva sin ese hueco de espera.
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.poll();
  }

  private async closeAllActive(reason: string): Promise<void> {
    if (this.active.size === 0) return;

    const endedAt = new Date();
    await withDbAccess(async () => {
      for (const [key, activeSession] of this.active) {
        await closeSession(activeSession.sessionId, endedAt);
        console.log(
          `[watcher] [${reason}] ${key} pausado -> sesion ${activeSession.sessionId} cerrada`,
        );
      }
      this.active.clear();
    });

    this.notifyRenderer();
    this.onActiveGamesChange?.(this.getActiveTitles());
  }

  private async poll(): Promise<void> {
    // Nada que hacer con el PC bloqueado/suspendido — pause() ya cerró todo
    // lo que hubiera; escanear ahora solo reabriría sesiones sin querer.
    if (this.paused) return;
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
        const untrackedKeys = Array.from(running.keys()).filter((key) => !this.active.has(key));
        if (untrackedKeys.length > 0) {
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
          for (const key of untrackedKeys) {
            const info = running.get(key);
            if (!info) continue;

            const existingOpen = openSessions.find((session) => openSessionKey(session) === key);
            if (existingOpen) {
              this.active.set(key, {
                pid: info.pid,
                sessionId: existingOpen.sessionId,
                title: info.target.title,
              });
              console.log(
                `[watcher] [adopt] "${info.target.title}" (pid ${info.pid}) -> sesion ${existingOpen.sessionId}`,
              );
              continue;
            }

            // La ÚNICA bifurcación juego/emulador de todo el watcher: un
            // juego deja su playthrough en "Playing" y cuelga la sesión de
            // él; un emulador crea una sesión sin juego asignado (bandeja
            // Pending, EMULADORES.md §4). Cierre, latido, adopción y
            // reconciliación son idénticos para los dos a partir de aquí.
            const session =
              info.target.kind === 'game'
                ? await startGameSession(info.target.refId)
                : await createEmulatorSession(info.target.refId);
            if (session) {
              this.active.set(key, {
                pid: info.pid,
                sessionId: session.id,
                title: info.target.title,
              });
              console.log(
                `[watcher] [start] "${info.target.title}" (pid ${info.pid}) -> sesion ${session.id}`,
              );
              changed = true;
            }
          }
        }

        // Cierres: seguíamos una sesión y el proceso ya no corre. Se cierra a
        // la hora actual (la detección es de ~5s, así que la duración es
        // fiable).
        for (const [key, activeSession] of this.active) {
          if (running.has(key)) continue;

          await closeSession(activeSession.sessionId, new Date());
          this.active.delete(key);
          console.log(
            `[watcher] [stop] ${key} cerrado -> sesion ${activeSession.sessionId} cerrada`,
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
  // parar. Por cada una: si el dueño (juego o emulador) está corriendo AHORA
  // se adopta (para cerrarla bien cuando muera); si no, ya no es válida y se
  // cierra en su último latido del watcher (`lastHeartbeatAt`) — así se
  // conserva el tiempo jugado hasta ~5s antes del corte, sin inflarlo con el
  // hueco app-apagada. Si nunca latió (sesión manual, o murió en el primer
  // ciclo) se cae a `startedAt` → duración 0, sin inventar horas que no se
  // midieron.
  private async reconcileOpenSessions(running: Map<string, RunningTarget>): Promise<boolean> {
    const openSessions = await getOpenSessions();
    let changed = false;

    for (const session of openSessions) {
      const key = openSessionKey(session);
      const runningTarget = key !== null ? running.get(key) : undefined;
      if (key !== null && runningTarget) {
        this.active.set(key, {
          pid: runningTarget.pid,
          sessionId: session.sessionId,
          title: runningTarget.target.title,
        });
      } else {
        const endedAt = session.lastHeartbeatAt ?? session.startedAt;
        await closeSession(session.sessionId, endedAt);
        console.log(
          `[watcher] [info] sesion ${session.sessionId} (${key ?? 'sin dueno'}) recuperada al arrancar - cerrada en su ultimo latido`,
        );
        changed = true;
      }
    }

    return changed;
  }

  // Fase 1 (barrido barato por nombre) + Fase 2 (verificación por ruta),
  // SPEC sección 7. Devuelve qué objetivos vigilados están corriendo ahora,
  // por clave ("game:12" / "emu:3").
  private async scan(targets: WatchTarget[]): Promise<Map<string, RunningTarget>> {
    const running = new Map<string, RunningTarget>();
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
      if (running.has(target.key)) continue;

      // null = "no se pudo leer la ruta del proceso": pasa con juegos
      // protegidos por anti-cheat (bloquean la introspección vía WMI incluso
      // al mismo usuario) y si el pid murió entre Fase 1 y 2.
      let cmd: string | null = null;
      try {
        const [detail] = await find('pid', pid);
        cmd = detail?.cmd?.trim() ? detail.cmd.toLowerCase() : null;
      } catch {
        cmd = null;
      }

      // Camino NORMAL: la ruta se pudo leer — ella decide, en exclusiva.
      // Si no coincide con la configurada es otro programa con el mismo
      // nombre de exe y se descarta, exactamente igual que siempre; la
      // Fase 2b de abajo ni se consulta en este caso.
      if (cmd !== null) {
        if (cmd.includes(target.exePath)) {
          running.set(target.key, { pid, target });
        }
        continue;
      }

      // Fase 2b — comprobación EXCEPCIONAL, solo al no poder leer la ruta:
      // Windows bloquea contra escritura el .exe en ejecución, así que si EL
      // ARCHIVO CONCRETO configurado está bloqueado ahora mismo (habiendo
      // además un proceso vivo con su mismo nombre), es este juego. Un
      // "game.exe" ajeno corriendo desde otra carpeta no bloquea nuestro
      // archivo — la protección contra nombres duplicados se mantiene.
      if (isExecutableBusy(target.exePath)) {
        running.set(target.key, { pid, target });
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
