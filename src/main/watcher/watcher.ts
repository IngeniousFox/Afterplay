import { powerMonitor, type BrowserWindow } from 'electron';
import { closeSync, openSync } from 'node:fs';
import { withDbAccess } from '../db';
import { getWatchTargets, type WatchTarget } from '../db/queries/games/getWatchTargets';
import { getIterationGameId } from '../db/queries/iterations/getIterationGameId';
import { closeSession, closeSessionIfOpen } from '../db/queries/sessions/closeSession';
import { createEmulatorSession } from '../db/queries/sessions/createEmulatorSession';
import { getOpenSessions, type OpenSession } from '../db/queries/sessions/getOpenSessions';
import { getSessionClosedInfo } from '../db/queries/sessions/getSessionClosedInfo';
import { heartbeatSessions } from '../db/queries/sessions/heartbeatSessions';
import { startGameSession } from '../db/queries/sessions/startGameSession';
import { scheduleSaveBackup } from '../saves/sessionHook';
import { sendToOverlay } from '../overlay';
import { notifySessionClosed } from './notifySession';

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

// ¿Sigue la sesión de Windows detrás de la pantalla de bloqueo AHORA MISMO?
//
// Se le pregunta AL SISTEMA en vez de llevar la cuenta de los eventos de
// powerMonitor, porque esa cuenta no cuadra: 'lock-screen' y 'suspend' pausan
// por separado, pero al despertar con contraseña Windows manda 'resume' ANTES
// que 'unlock-screen'. Con un solo booleano, ese primer aviso despausaba con
// la pantalla todavía bloqueada y el juego seguía sumando minutos que nadie
// jugó (SPEC-2 §7.2: el tiempo con la pantalla bloqueada no es tiempo
// jugado). Aquí no hay pares de eventos que emparejar: el estado real lo dice
// el escritorio de entrada.
//
// 'locked' solo lo reportan Windows y macOS; cualquier otra respuesta
// ('active'/'idle'/'unknown') —o un fallo— cuenta como DESBLOQUEADA a
// propósito: quedarse pausado para siempre sería peor que despausar de más,
// porque mataría en silencio toda la detección hasta reiniciar la app.
const isScreenLocked = (): boolean => {
  try {
    return powerMonitor.getSystemIdleState(1) === 'locked';
  } catch {
    return false;
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
//
// El emulador manda sobre el juego, y el orden NO es cosmético: assignSession
// CONSERVA el emulatorId al asignar (EMULADORES.md §5), así que una sesión de
// emulador asignada en caliente —la bandeja Pending deja asignar sesiones
// todavía vivas, con su badge LIVE— acaba con los dos campos puestos. Con
// gameId primero, su clave pasaba a ser "game:X" mientras el objetivo
// vigilado seguía siendo "emu:3": un juego emulado nunca tiene
// executablePath, así que "game:X" NO EXISTE como objetivo y ni la
// reconciliación ni la adopción por ciclo la encontraban — se cerraba viva y
// el mismo ciclo abría otra por el emulador. emulatorId es el registro de QUÉ
// PROCESO vigila el watcher; gameId solo dice a quién se le imputan las horas.
const openSessionKey = (session: OpenSession): string | null => {
  if (session.emulatorId !== null) return `emu:${session.emulatorId}`;
  if (session.gameId !== null) return `game:${session.gameId}`;
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
  // true tras stop() (cierre de la app). Los oyentes de powerMonitor
  // (main/index.ts) siguen vivos y un unlock/resume durante el apagado
  // llamaría a resume() -> poll() con la DB desmontándose, abriendo una
  // sesión fantasma. El ScanWatcher hermano ya se blinda con un flag igual;
  // este no lo tenía.
  private stopped = false;
  // true mientras el PC está bloqueado o suspendido (powerMonitor, ver
  // main/index.ts). El sondeo se salta entero mientras tanto — nada de
  // escanear procesos ni de abrir sesiones nuevas — para que un juego que
  // sigue "corriendo" detrás de la pantalla de bloqueo no reabra sola una
  // sesión a los 5s de haberla cerrado por pausa.
  private paused = false;
  // Ha llegado un 'resume'/'unlock-screen' pero todavía no se ha despausado.
  // Las DOS causas de pausa (bloqueo y suspensión) comparten un único
  // booleano, así que el aviso de vuelta no basta por sí solo: hace falta
  // además que el sistema diga que la pantalla ya no está bloqueada (ver
  // isScreenLocked y resume()). Se guarda porque el aviso puede llegar
  // pronto —'resume' precede a 'unlock-screen' cuando Windows pide
  // contraseña al despertar— y entonces despausa el sondeo, en cuanto el
  // sistema conteste que no, no hay bloqueo.
  private resumeRequested = false;
  // Foto anterior: sesiones abiertas que el watcher sigue, indexadas por la
  // clave del objetivo ("game:12" / "emu:3" — SPEC 4.5: como mucho una
  // sesión abierta por juego, y el dedup de createEmulatorSession garantiza
  // lo mismo por emulador). Sobrevive entre ciclos; NO se recalcula desde
  // la DB.
  private readonly active = new Map<string, ActiveSession>();
  // Objetivos que están corriendo pero cuyo tiempo lleva un cronómetro del
  // móvil (REMOTO.md §7), y a los que por eso no se les abre sesión propia.
  // Solo existe para que ese aviso salga UNA vez y no cada 5s durante toda la
  // partida: cada ciclo que llega a mirar los arranques lo reemplaza entero,
  // así que no hay nada que limpiar al pausar ni al parar (y que un ciclo
  // abortado a medias lo deje como estaba es lo que se quiere: al volver de
  // una pausa no hay que volver a contar lo mismo).
  private timerHeldKeys = new Set<string>();
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
    this.stopped = false;
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
    this.stopped = true;
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
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.resumeRequested = false;
    // closeAllActive nunca rechaza (envuelve cada cierre en su try/catch),
    // pero el .catch queda por si acaso: un void sin red de seguridad sería
    // una promesa rechazada sin dueño si eso cambiara.
    void this.closeAllActive('pause').catch(() => {});
  }

  // 'resume'/'unlock-screen': PIDE la vuelta y sondea ya, sin esperar al
  // próximo tick (hasta 5s) — si el juego seguía corriendo detrás del
  // bloqueo, se retoma con una sesión nueva sin ese hueco de espera.
  //
  // Pedirla no es despausar. Un bloqueo + una suspensión pausan DOS veces
  // (dos oyentes distintos, un solo booleano) y basta un 'resume' para
  // deshacerlo: como al despertar con contraseña Windows manda 'resume' antes
  // que 'unlock-screen', despausar aquí contaba como jugado todo el rato que
  // tardaras en teclear la contraseña. Quien decide es poll(), preguntándole
  // al sistema si la pantalla sigue bloqueada; y como el flag sobrevive, si
  // ese primer aviso llega en bloqueo, el propio tick de 5s recoge el
  // desbloqueo aunque el 'unlock-screen' se pierda o llegue con retraso.
  resume(): void {
    if (this.stopped || !this.paused) return;
    this.resumeRequested = true;
    void this.poll();
  }

  private async closeAllActive(reason: string): Promise<void> {
    if (this.active.size === 0) return;

    const endedAt = new Date();
    await withDbAccess(async () => {
      // Cada cierre en su try/catch: si uno falla (la DB justo en un swap, un
      // corte), los demás se cierran igual y `active` se vacía pase lo que
      // pase (finally). Sin esto, un solo rechazo dejaba `active` intacto —
      // sesiones fantasma vivas y la bandeja mostrando juegos "en marcha"
      // tras un bloqueo — y propagaba una promesa sin dueño desde pause().
      try {
        for (const [key, activeSession] of this.active) {
          try {
            await closeSession(activeSession.sessionId, endedAt);
            console.log(
              `[watcher] [${reason}] ${key} pausado -> sesion ${activeSession.sessionId} cerrada`,
            );
          } catch (error) {
            console.error(`[watcher] [${reason}] no se pudo cerrar ${key}:`, error);
          }
        }
      } finally {
        this.active.clear();
      }
    });

    this.notifyRenderer();
    this.onActiveGamesChange?.(this.getActiveTitles());
  }

  private async poll(): Promise<void> {
    // Nada que hacer con la app apagándose.
    if (this.stopped) return;

    // Con el PC bloqueado/suspendido no se escanea — pause() ya cerró todo lo
    // que hubiera; hacerlo ahora solo reabriría sesiones sin querer. La vuelta
    // se decide AQUÍ y en ningún otro sitio: hace falta que alguien la haya
    // pedido ('resume'/'unlock-screen') Y que el sistema confirme que la
    // pantalla ya no está bloqueada. El tick de 5s sigue corriendo mientras
    // tanto, así que este mismo control reintenta solo hasta que el bloqueo
    // se levanta. Sin la primera condición, un tick que cayera entre el
    // 'suspend' y el sueño real de la máquina (Windows puede tardar) vería
    // "no bloqueado", despausaría y reabriría la sesión que pause() acababa
    // de cerrar — para dejarla abierta durante todo el sueño.
    if (this.paused) {
      if (!this.resumeRequested || isScreenLocked()) return;
      this.paused = false;
      this.resumeRequested = false;
      console.log('[watcher] reanudado - el PC ya no esta bloqueado');
    }
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

      // scan() puede tardar segundos, y en ese hueco el PC ha podido
      // bloquearse (pause() cerró y vació `active`) o la app apagarse. Sin
      // este segundo control, seguiríamos con la foto PRE-pausa: todo lo que
      // corría se vería "sin seguir", abriríamos sesiones NUEVAS y las
      // latiríamos durante todo el bloqueo — justo lo que la pausa evita.
      // withDbAccess es un contador, no un mutex: no serializa, hay que
      // releer el flag aquí.
      if (this.paused || this.stopped) return;

      const changed = await withDbAccess(async () => {
        let changed = false;

        // Foto única de las sesiones abiertas para todo el ciclo: la comparten
        // el barrido de cronómetros, la reconciliación del arranque y la
        // adopción de abajo. Antes solo se pedía cuando había algo sin seguir;
        // ahora sale en cada vuelta porque el barrido la necesita siempre — un
        // SELECT diminuto por índice sobre el SQLite local, del mismo orden que
        // el getWatchTargets que ya se paga cada 5s.
        const openSessions = await getOpenSessions();

        // Cronómetros abandonados (REMOTO.md §7.4): en CADA ciclo, no solo al
        // arrancar.
        changed = (await this.sweepStaleTimerSessions(openSessions)) || changed;

        // La primera vuelta reconcilia las sesiones que quedaron abiertas de una
        // ejecución anterior o de un Play manual colgado.
        if (!this.reconciled) {
          this.reconciled = true;
          changed = (await this.reconcileOpenSessions(openSessions, running)) || changed;
        }

        // Arranques: corriendo ahora y sin sesión que el watcher siga todavía.
        const untrackedKeys = Array.from(running.keys()).filter((key) => !this.active.has(key));
        const nowMs = Date.now();
        // La foto de este ciclo para `timerHeldKeys` (ver el campo): sustituye
        // a la anterior al terminar el bucle.
        const timerHeldNow = new Set<string>();
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
          //
          // Los CRONÓMETROS quedan fuera: no los abrió el watcher y su vida no
          // depende de ningún proceso (REMOTO.md §7). Adoptar uno significaba
          // cerrarlo al morir el .exe con el startedAt del móvil, que puede ser
          // del día anterior — una sesión de veinte horas en el heatmap. Quien
          // se ocupa de ellos es sweepStaleTimerSessions, con la regla de
          // frescura; mientras siga fresco, el juego se queda sin sesión propia
          // a propósito: su tiempo ya lo está contando el cronómetro y dos
          // sesiones vivas del mismo juego serían horas contadas dos veces.
          // Ese "mientras" puede durar HORAS (hasta que el cronómetro se ponga
          // rancio), así que ese caso se corta abajo ANTES de llamar a la DB.
          for (const key of untrackedKeys) {
            const info = running.get(key);
            if (!info) continue;

            const existingOpen = openSessions.find(
              (session) => session.startedBy !== 'timer' && openSessionKey(session) === key,
            );
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

            // Un CRONÓMETRO VIVO por este mismo objetivo: el juego está en
            // marcha pero su tiempo lo lleva el móvil. No se adopta (filtro de
            // arriba) y tampoco se abre sesión propia — startGameSession
            // encontraría esa sesión abierta y devolvería null igual, así que
            // el resultado es el mismo. Se corta antes de llamarla porque esta
            // clave se queda en `untrackedKeys` hasta que el cronómetro se
            // pare o se ponga rancio, y llamar era pagar una transacción de la
            // DB cada 5s durante horas para no hacer nada. El aviso sale una
            // sola vez, no en cada vuelta: desde fuera el síntoma es "tengo el
            // juego abierto y Afterplay no me lo registra", y sin una línea que
            // lo explique no había ni rastro de por qué.
            //
            // El precio de no abrirla no es nuevo —llamar a startGameSession
            // tampoco la abría— pero conviene tenerlo escrito: mientras mande
            // el cronómetro, esta clave NO está en `active`, así que
            // isGameRunning (la guarda de restaurar partidas guardadas) y
            // getActiveGameIds (el sondeo en vivo de logros de Steam) no ven
            // este juego como "en marcha".
            //
            // Se vuelve a mirar la frescura (§7.4) porque `openSessions` es la
            // foto de ANTES del barrido: un cronómetro rancio ya lo cerró
            // sweepStaleTimerSessions en este mismo ciclo, y darlo aquí por
            // vivo retrasaría la sesión de verdad un ciclo entero y cantaría un
            // aviso falso.
            const timerOpen = openSessions.find(
              (session) =>
                session.startedBy === 'timer' &&
                openSessionKey(session) === key &&
                !ProcessWatcher.isTimerStale(session, nowMs),
            );
            if (timerOpen) {
              timerHeldNow.add(key);
              if (!this.timerHeldKeys.has(key)) {
                console.log(
                  `[watcher] [info] "${info.target.title}" en marcha, pero su tiempo lo lleva el cronometro (sesion ${timerOpen.sessionId}) - no abro otra`,
                );
              }
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
        this.timerHeldKeys = timerHeldNow;

        // Cierres: seguíamos una sesión y el proceso ya no corre. Se cierra a
        // la hora actual (la detección es de ~5s, así que la duración es
        // fiable).
        for (const [key, activeSession] of this.active) {
          if (running.has(key)) continue;

          const closed = await closeSessionIfOpen(activeSession.sessionId, new Date());
          this.active.delete(key);
          console.log(
            `[watcher] [stop] ${key} cerrado -> sesion ${activeSession.sessionId} cerrada`,
          );
          changed = true;

          // El momento del cierre: es cuando el diario de sesión ("dónde lo
          // dejé") se escribe en caliente. Solo con la sesión ya asignada a
          // un juego — una de emulador sin asignar no tiene de qué hablar
          // todavía, y su aviso saldría sin título.
          if (closed && closed.iterationId !== null) {
            const info = await getSessionClosedInfo(closed.id);
            if (info) notifySessionClosed(info);
          }

          // Momento exacto en que la partida guardada ha cambiado y un
          // backup vale algo (PARTIDAS-GUARDADAS.md §10.2). Se dispara sin
          // esperar: la subida corre por su cuenta con su propio retardo y
          // NUNCA lanza, así que un fallo de nube no puede tumbar el ciclo
          // del watcher ni retrasar el cierre de sesión.
          const gameId = Number(key.slice('game:'.length));
          if (key.startsWith('game:') && Number.isFinite(gameId)) {
            void scheduleSaveBackup(gameId);
          } else if (closed && closed.iterationId !== null) {
            // Sesión de EMULADOR ("emu:N") que el usuario asignó a un juego
            // emulado mientras seguía jugando: la clave no sabe de juegos,
            // pero la sesión ya sí. Sin esta rama, ese juego se quedaba sin
            // backup automático SIEMPRE — la clave nunca empieza por "game:"
            // y el disparador de arriba ni lo miraba.
            const assignedGameId = await getIterationGameId(closed.iterationId);
            if (assignedGameId !== null) void scheduleSaveBackup(assignedGameId);
          }
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

  // Cuánto puede callarse un cronómetro antes de darlo por abandonado.
  //
  // GENEROSO a propósito, y no los pocos minutos que sugeriría un latido de uno
  // por minuto. El §7.5 avisa de por qué: los navegadores móviles suspenden las
  // pestañas de fondo sin piedad, así que es normal que el latido se pare
  // MIENTRAS SIGUES JUGANDO. Con un umbral corto, una tarde de consola con el
  // móvil en el bolsillo se cortaría por la mitad.
  //
  // El precio es el opuesto y está asumido (§7.6): dormirse con el cronómetro
  // puesto suma hasta seis horas de más. Pero eso se corrige después editando
  // la sesión, y perder tiempo real no se corrige con nada.
  //
  // El número está escrito DOS veces, aquí y en TIMER_STALE_MS del Worker
  // (worker/src/queries/timer.ts), que barre lo mismo contra Turso con esta
  // misma regla. El sitio bueno es src/shared, junto a playthroughState, donde
  // ya viven las reglas que los dos lados comparten; mientras siga duplicado,
  // tocar un número obliga a tocar el otro.
  private static readonly TIMER_STALE_HOURS = 6;

  // El último latido de un cronómetro, o su arranque si nunca llegó a latir (la
  // pestaña murió en el primer minuto). Es a la vez la vara de la regla de
  // frescura y la hora en la que se cierra si está rancio — la misma pareja que
  // usa el Worker.
  private static readonly timerLastBeat = (session: OpenSession): Date =>
    session.lastHeartbeatAt ?? session.startedAt;

  // La regla de frescura del §7.4, en un solo sitio porque la miran dos: el
  // barrido de rancios y el bucle de arranques, que necesita saber si el
  // cronómetro sigue vivo antes de decidir no abrir sesión propia.
  private static readonly isTimerStale = (session: OpenSession, now: number): boolean =>
    now - ProcessWatcher.timerLastBeat(session).getTime() >=
    ProcessWatcher.TIMER_STALE_HOURS * 3_600_000;

  // Las sesiones de CRONÓMETRO (REMOTO.md §7) no tienen proceso: las abre el
  // móvil para una consola física, GeForce Now o cualquier cosa que este
  // watcher no puede ver. Su única regla es la de frescura del §7.4: si latió
  // hace poco estás jugando y no se toca —ni aunque el PC se haya reiniciado
  // por medio—; si lleva horas mudo se da por abandonada y se cierra en su
  // último latido, que es lo más cerca del final real que se puede afinar sin
  // inventar.
  //
  // Corre en CADA ciclo, no dentro de la reconciliación del arranque: la app
  // vive días en la bandeja (SPEC 3E, la X la esconde y solo Quit cierra), así
  // que con la regla solo en el arranque un cronómetro olvidado por la noche
  // se quedaba abierto hasta el siguiente reinicio — el juego pintado LIVE en
  // la biblioteca y sus horas sin contar (durationSec null) todo ese tiempo.
  //
  // closeSessionIfOpen y no closeSession: `openSessions` es una FOTO tomada al
  // principio del ciclo (SELECT con endedAt IS NULL), y entre esa foto y este
  // UPDATE la sesión puede haberla cerrado OTRO. Los dos candidatos reales
  // llegan por el pull del ciclo de sync, que corre por su cuenta cada 60s y no
  // se serializa con este sondeo: el "parar" pulsado en el móvil —que manda
  // sobre el latido, §7.5— y el barrido gemelo del Worker, que aplica esta
  // MISMA regla de las 6h contra Turso (worker/src/queries/timer.ts). La hora
  // de fin no corre peligro en ninguno de los dos casos (closeSession devuelve
  // la fila ya cerrada tal cual, sin recalcular), pero al ser truthy cantaría
  // el log y marcaría `changed` por un cierre ajeno y con una hora que no es la
  // que quedó guardada. Lo que NO puede pasar es repetirse en bucle: la foto se
  // relee en cada vuelta, así que una sesión ya cerrada no vuelve a entrar
  // aquí.
  private async sweepStaleTimerSessions(openSessions: OpenSession[]): Promise<boolean> {
    const now = Date.now();
    let changed = false;

    for (const session of openSessions) {
      if (session.startedBy !== 'timer') continue;
      if (!ProcessWatcher.isTimerStale(session, now)) continue;

      const lastBeat = ProcessWatcher.timerLastBeat(session);
      const closed = await closeSessionIfOpen(session.sessionId, lastBeat);
      if (!closed) continue;
      console.log(
        `[watcher] [info] sesion ${session.sessionId} de cronometro sin latir ${ProcessWatcher.TIMER_STALE_HOURS}h - cerrada en su ultimo latido`,
      );
      changed = true;
    }

    return changed;
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
  private async reconcileOpenSessions(
    openSessions: OpenSession[],
    running: Map<string, RunningTarget>,
  ): Promise<boolean> {
    let changed = false;

    for (const session of openSessions) {
      // Los cronómetros no son del watcher y aquí no hay nada que decidir
      // sobre ellos: no hay proceso que buscar en `running`, así que cerrarlos
      // por no encontrarlo los mataría en el acto con duración 0 — justo el
      // obstáculo que documenta el §7.3. De ellos se ha encargado ya
      // sweepStaleTimerSessions, en este mismo ciclo y en todos los demás.
      if (session.startedBy === 'timer') continue;

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

  // ¿Está corriendo AHORA este juego? Sale del mapa en memoria, sin escanear
  // procesos ni tocar la DB. Lo consume la guarda de restauración de partidas
  // guardadas vía watcher/runningGames.ts.
  isGameRunning(gameId: number): boolean {
    return this.active.has(`game:${gameId}`);
  }

  // Qué JUEGOS (no emuladores) están corriendo AHORA. Mismo mapa en memoria
  // que isGameRunning, sin escanear procesos ni tocar la DB. Lo consume el
  // sondeo en vivo de logros de Steam (steam/livePoll.ts): solo tiene
  // sentido preguntarle a Steam por lo que se está jugando en este momento.
  getActiveGameIds(): number[] {
    const ids: number[] = [];
    for (const key of this.active.keys()) {
      if (key.startsWith('game:')) ids.push(Number(key.slice('game:'.length)));
    }
    return ids;
  }

  // ¿Hay ALGÚN emulador en marcha? Lo consume el sondeo en vivo de
  // RetroAchievements (ra/livePoll.ts): sin emulador no puede estar cayendo
  // ningún logro retro, y sondear en vacío sería ruido de red perpetuo.
  hasActiveEmulator(): boolean {
    for (const key of this.active.keys()) {
      if (key.startsWith('emu:')) return true;
    }
    return false;
  }

  private getActiveTitles(): string[] {
    return Array.from(this.active.values(), (session) => session.title);
  }

  private notifyRenderer(): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('games:changed');
    }
    // Y al HUD, que es otra ventana con otro caché (ver sendToOverlay en
    // overlay.ts). Su OverlayHud lleva desde el principio suscrito a este
    // aviso, pero el aviso solo salía hacia mainWindow — así que aquella
    // suscripción no llegó a dispararse nunca.
    sendToOverlay('games:changed');
  }
}
