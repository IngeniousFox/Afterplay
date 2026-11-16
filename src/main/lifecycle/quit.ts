import { app } from 'electron';
import { appState } from '../bootstrap/appState';
import { closeAppDb } from '../db/v2/appDb';
import { isE2E } from '../lib/e2e';
import { flushPendingSaveBackups } from '../saves/sessionHook';
import { stopEmuWatcher } from '../steam/emu/watcher';
import { stopSteamLivePoll } from '../steam/livePoll';
import { closeAchievementOverlay } from '../steam/notifications/overlay';
import { stopRaLivePoll } from '../ra/livePoll';
import { runQuitSequence } from '../watcher/quitSequence';
import { destroyOverlay } from '../windows/overlay';

// SPEC 3E — el botón X de la ventana oculta, no cierra: solo "Quit" del tray
// (o antes de la propia app.quit(), en before-quit) marca esto para dejar
// pasar el cierre real. Sin esto, la app no podría cerrarse nunca de verdad.
let isQuitting = false;
// `quitSequenceStarted` evita repetir el cierre ordenado (sesiones, backups,
// subida final) cuando before-quit vuelve a dispararse tras app.quit().
let quitSequenceStarted = false;

export const isAppQuitting = (): boolean => isQuitting;

// El cierre REAL (el "Quit" del tray y el del menú del modo TV): sin marcar
// isQuitting, el interceptor de la X lo convertiría en un simple esconderse a
// la bandeja.
export const quitApp = (): void => {
  isQuitting = true;
  app.quit();
};

export const registerQuitLifecycle = (): void => {
  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Se dispara para CUALQUIER cierre real (menú "Quit" del tray, Cmd+Q en
  // macOS, apagado del sistema...) antes de que las ventanas reciban su propio
  // evento 'close' — marcarlo aquí, y no solo en el click del tray, asegura que
  // ninguna vía de cierre real se quede bloqueada por el interceptor de la X.
  app.on('before-quit', (event) => {
    isQuitting = true;
    // Cierre ordenado (§10.6): se aplaza el cierre UNA vez, con tope global, para
    // (1) cerrar las sesiones propias a la hora actual, (2) lanzar los backups de
    // partidas pendientes y (3) subir lo último al hub (5 s). La base sigue
    // abierta (se cierra en will-quit) y el resto del cierre corre al volver a
    // llamar a quit(). En E2E no se aplaza nada: el sync no existe y los tests
    // cierran y reabren la app esperando el estado de siempre.
    if (!quitSequenceStarted && !isE2E() && (appState.watcher || appState.syncRuntime?.isActive)) {
      quitSequenceStarted = true;
      event.preventDefault();
      void runQuitSequence({
        closeSessions: () => {
          appState.watcher?.closeAllForQuit(new Date());
        },
        // Lanza ya los backups de partidas pendientes (también los que acaba de
        // armar el cierre de sesiones), sin el margen de 8 s, y espera hasta 4 s.
        flushSaveBackups: (timeoutMs) => flushPendingSaveBackups(timeoutMs),
        flushSync: () => appState.syncRuntime?.flushOnQuit() ?? Promise.resolve(),
      }).finally(() => app.quit());
      return;
    }
    appState.networkWatch?.stop();
    appState.watcher?.stop();
    appState.scanWatcher?.stop();
    // La ventana del aviso de logros vive fuera del ciclo de la principal: sin
    // esto, una tarjeta en pantalla al salir mantendría el proceso vivo.
    closeAchievementOverlay();
    // Y la del overlay in-game igual (§5.7) — además suelta atajo y mando.
    destroyOverlay();
    stopEmuWatcher();
    stopRaLivePoll();
    stopSteamLivePoll();
    if (appState.memoriesTimer) clearInterval(appState.memoriesTimer);
  });

  // La base se cierra lo último, cuando ya no queda ventana ni vigilante: una
  // pasada de fondo que todavía esté en marcha falla con su propio aviso en vez
  // de escribir en una conexión cerrada a medias.
  app.on('will-quit', () => {
    closeAppDb();
  });
};
