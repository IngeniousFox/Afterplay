import { emit } from '../ipc/contractHandlers';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { app, dialog, Menu } from 'electron';
import { initCredentials } from '../config/credentials';
import { runDailyBackup } from '../db/dailyBackup';
import { appLocalDb, initAppDb } from '../db/v2/appDb';
import { isDevProfile } from '../lib/devProfileRules';
import { isE2E } from '../lib/e2e';
import { cutoverNeeded } from '../migration/cutoverProgress';
import { runCutover } from '../migration/cutoverRuntime';
import { runEnrichPending } from '../external/enrichPendingApp';
import { registerImageProtocolHandler } from '../images/protocol';
import { registerIpcHandlers } from '../ipc';
import { registerBigPictureIpc } from '../ipc/mainProcess';
import icon from '../lib/appIcon';
import { wasOpenedHiddenAtLogin } from '../lib/loginItem';
import { applyYoutubeReferer } from '../lib/youtubeReferer';
import { registerActivate } from '../lifecycle/activate';
import { registerPowerEvents } from '../lifecycle/power';
import { quitApp } from '../lifecycle/quit';
import { ScanWatcher, setScanWatcher } from '../scan/watcher';
import { createSplashWindow } from '../splash/splash';
import { createAppSyncRuntime } from '../sync/appRuntime';
import { createAppTray, setTrayActiveGames } from '../tray/tray';
import { setRunningGamesProbe } from '../watcher/runningGames';
import { ProcessWatcher } from '../watcher/watcher';
import { isBigPictureMode } from '../windows/bigPicture';
import { announceStoreChanges, announceSyncChange } from '../windows/dataChanged';
import { forwardToWindow } from '../windows/forward';
import {
  createWindow,
  getMainWindow,
  getSplashWindow,
  markDbReady,
  setSplashWindow,
  showMainWindow,
} from '../windows/mainWindow';
import { handleOverlayActiveGames } from '../windows/overlay';
import { wireSessionClosedNotice } from '../windows/sessionClosedNotice';
import { appState } from './appState';
import { startBackgroundJobs } from './backgroundJobs';
import { wireDomainNotifiers } from './notifiers';
import { mark } from './startupClock';

// Las fases del arranque, explícitas y en el orden de AFTERPLAY-2.0.md §15.1.
// Cada una es una función; runStartup() las encadena. Lo que una fase deja
// hecho y la siguiente da por supuesto está dicho en su cabecera.

// la cáscara de Electron. Depende de: app.whenReady().
function startElectronShell(): void {
  mark('electron listo (whenReady)');

  // Sin menú de aplicación: era invisible (frame:false + autoHideMenuBar)
  // y solo aportaba accelerators fantasma — el F11 de fullscreen que ahora
  // es el toggle de Big Picture (ver before-input-event en createWindow).
  // F12/Ctrl+R de desarrollo no viven aquí (los pone watchWindowShortcuts).
  Menu.setApplicationMenu(null);

  // Windows resolves the installed app name through this identity. Set it
  // before creating any window; it must match electron-builder.yml.
  // Development still runs electron.exe without an installed shortcut.
  electronApp.setAppUserModelId('com.afterplay.app');

  // Cover every native surface, including overlays and future windows.
  // macOS takes its Dock/app icon from the packaged .icns resource.
  app.on('browser-window-created', (_, window) => {
    if (process.platform !== 'darwin') window.setIcon(icon);
    optimizer.watchWindowShortcuts(window);
  });

  // Splash — tan pronto como Electron deja crear ventanas, antes de nada
  // más (abrir la base, arranque del bundle del renderer...). Si la app la abrió Windows sola al iniciar sesión, no
  // hay nada que enseñar todavía (arranca directa a la bandeja, SPEC 3E) —
  // mismo chequeo que createWindow() usa para decidir si mostrarse, con la
  // misma excepción: --bigpicture quiere pantalla.
  if (!wasOpenedHiddenAtLogin() || isBigPictureMode()) setSplashWindow(createSplashWindow());
  mark('splash creado');
}

// configuración y credenciales. Depende de: app.whenReady()
// (safeStorage lo exige).
function loadConfigAndCredentials(): void {
  // Credenciales (Twitch/IGDB, SteamGridDB, almacenamiento) del almacén
  // cifrado de userData a process.env — TIENE que ir tras whenReady
  // (safeStorage lo exige).
  // Sin ninguna configurada la app arranca igual, en modo local: las claves
  // se meten desde Ajustes y se aplican en caliente, sin reiniciar.
  try {
    initCredentials();
  } catch (error) {
    console.warn('[credentials] fallo cargando credenciales (sigo sin ellas):', error);
  }
  mark('credenciales cargadas');
}

// registro de IPC y ventana. Depende de: nada de la base (la apertura
// es síncrona y ninguna petición del renderer se atiende antes de ella).
function registerIpcAndCreateWindow(): void {
  registerIpcHandlers();
  mark('handlers IPC registrados');
  registerImageProtocolHandler();
  // Antes de crear la ventana: los tráilers de la ficha no se reproducen en la
  // app instalada sin esto (ver lib/youtubeReferer.ts para el porqué).
  applyYoutubeReferer();

  // IPC de Big Picture y del quit real, registrados AQUÍ y no en ipc/ — su
  // estado (bigPictureMode, isQuitting) vive en windows/ y lifecycle/.
  registerBigPictureIpc();

  // LA VENTANA, ANTES DE ABRIR LA BASE: el renderer arranca en su propio
  // proceso mientras el principal abre (y la primera vez importa) la base, así
  // que las dos esperas no se suman. Es seguro porque los handlers ya están
  // registrados y la apertura es síncrona: ninguna petición del renderer se
  // atiende antes de que la base esté abierta. La ventana no se ENSEÑA hasta
  // que las dos cosas están (ver revealWhenReady).
  createWindow();
  mark('ventana creada (el renderer empieza a cargar)');
}

// base local: abrir y migrar. Devuelve false si la app no puede
// seguir (el aviso y el app.quit() ya están hechos).
function openLocalDb(): boolean {
  // La base 2.0 (db/v2/appDb.ts): migra su esquema y, la primera vez en el
  // perfil de desarrollo o en un e2e, importa la 1.x (con copia previa en
  // backups/). Es SÍNCRONA: mientras corre, el proceso principal no atiende
  // nada, así que las peticiones que el renderer ya haya lanzado esperan en
  // la cola de IPC y entran con la base abierta. Si falla, la app no puede
  // funcionar: se avisa con el motivo real y se cierra.
  try {
    initAppDb();
  } catch (error) {
    console.error('[v2] no se pudo abrir la base:', error);
    getSplashWindow()?.close();
    dialog.showErrorBox(
      'Afterplay',
      'No se pudo preparar la base de datos. La app se va a cerrar.\n\n' +
        (error instanceof Error ? error.message : String(error)),
    );
    app.quit();
    return false;
  }
  mark('base 2.0 abierta');
  return true;
}

// Depende de: la base abierta. El sync se CREA aquí pero no arranca todavía: el
// primer ciclo va delante de las pasadas de fondo (ver backgroundJobs.ts).
function createSyncRuntime(): void {
  // El corte (más abajo) la crea al abrir la base; después el arranque normal la repite.
  if (appState.syncRuntime) return;
  // El aviso único de cambio de datos (§15.4): las transacciones locales y las
  // del watcher salen de la puerta de escritura, las de una bajada del sync
  // salen del motor (más abajo).
  announceStoreChanges(appLocalDb().store);
  const sendSyncStatus = forwardToWindow('sync:status');
  appState.syncRuntime = createAppSyncRuntime({
    changed: (change) => {
      announceSyncChange(change);
      // Juegos nuevos de otro dispositivo (los que añade el móvil llegan sin
      // comprobaciones externas, §13.3): este PC pide su concesión `enrich` y
      // los completa. Sin juegos nuevos en la bajada no hay nada que mirar.
      if (change.tables.includes('games')) void runEnrichPending();
    },
    status: () => sendSyncStatus(),
  });
}

// PUENTE 1.x → L3. El corte 1.x → 2.0 (§19.6), en lugar de `openLocalDb` cuando
// hay una 1.x sin migrar en este PC. Depende de: handlers IPC y ventana creados.
// NO enseña la biblioteca: la ventana ya está viva y pinta la pantalla de
// migración según `cutover:state`; esto no vuelve hasta que el corte termina
// con la base 2.0 abierta y el sync creado. Hasta entonces no corre nada que
// necesite la base (watchers, trabajos de fondo, bandeja).
async function runCutoverPhase(): Promise<void> {
  // La ventana no espera a la base: sin esto el splash taparía la migración.
  markDbReady();
  await runCutover({
    openDatabase: (mode) => {
      initAppDb({ fresh: mode === 'fresh' });
      createSyncRuntime();
      mark('base 2.0 abierta (corte)');
    },
  });
}

// ¿Hay que hacer el corte en este arranque? El perfil de desarrollo y los e2e
// importan solos (sin Turso); AFTERPLAY_CUTOVER=1 fuerza el corte real en un
// perfil de desarrollo (nunca en un e2e).
const needsCutover = (): boolean =>
  cutoverNeeded({
    userDataDir: app.getPath('userData'),
    isE2E: isE2E(),
    isDevProfile: isDevProfile(),
    force: process.env.AFTERPLAY_CUTOVER === '1',
  });

// Depende de: la base abierta y la ventana creada.
function revealWindowWhenDbReady(): void {
  // El otro reloj de la ventana (ver revealWhenReady en createWindow): si el
  // renderer ya terminó esto
  // la enseña en el acto; si no, la enseñará su propio 'ready-to-show'.
  //
  // Y aquí NO se abre la puerta de las peticiones de segunda instancia: eso lo
  // hace el propio reveal (ver windowRevealed). Que haya ventana, handlers IPC
  // y base no significa todavía que haya nada que enseñar — entre esta línea y
  // el reveal queda el tercer reloj, y atender ahí un doble clic es enseñar la
  // biblioteca en blanco con el splash al lado.
  markDbReady();

  // VACUUM INTO copia el fichero .db entero y nada de lo que sigue depende de
  // que esa copia exista ya. Va DESPUÉS de enseñar la ventana: la copia es
  // síncrona y no debe ir por delante de las primeras consultas del renderer.
  void runDailyBackup().catch((error: unknown) => {
    console.warn('[backup] fallo inesperado en la copia diaria (sigo igualmente):', error);
  });
}

// Bandeja del sistema (SPEC 3E): icono persistente con "Open"/"Quit" — la
// app sigue vigilando procesos aunque la ventana esté oculta, y solo se
// cierra de verdad desde aquí.
function createTray(): void {
  appState.tray = createAppTray({
    // La misma puerta que la segunda instancia y la notificación: traerla
    // delante con el pendingMaximize resuelto (ver showMainWindow).
    onOpen: showMainWindow,
    onQuit: () => {
      quitApp();
    },
  });
}

// watchers. Depende de: la ventana (para avisarle), el sync (para el
// sync rápido antes de crear un playthrough) y la bandeja.
function startWatchers(): void {
  // Watcher de procesos (Bloque 3): vigila los juegos armados (con
  // executablePath y playthrough activo) y registra sesiones automáticas.
  // Recibe un getter de la ventana en vez de la ventana directa porque esta
  // se recrea (macOS 'activate') y se destruye ('closed'). El segundo
  // parámetro (opcional, SPEC 3E) mantiene el tooltip del tray al día con lo
  // que esté en marcha ahora mismo, sin tener que abrir la ventana.
  const watcher = new ProcessWatcher(
    (titles) => {
      if (appState.tray) setTrayActiveGames(appState.tray, titles);
      // El overlay in-game vive y muere con los JUEGOS en marcha (OVERLAY.md
      // §5.7): con uno vivo registra su atajo, escucha el mando y PRECALIENTA
      // su ventana; al cerrarse el último lo suelta todo. Este callback
      // dispara en arranque, cierre Y adopción de sesiones — las dos ramas
      // por las que puede empezar una.
      //
      // Juegos, y no `titles.length`, que es lo que había aquí: esos títulos
      // son los de la BANDEJA e incluyen los emuladores (claves "emu:N"), y
      // el HUD no sabe pintar uno. Una sesión de emulador sin asignar nace
      // con iterationId null, así que getGames la tira en su innerJoin con
      // iterations y ningún juego queda isLive: con RetroArch en marcha y
      // ningún juego nativo, el atajo global quedaba registrado y pulsarlo
      // enseñaba una ventana transparente del tamaño del monitor con CERO
      // píxeles pintados — le robaba el foco al emulador (muchos se pausan al
      // perderlo) y se comía todos los clics, ni siquiera el clic al fondo la
      // cerraba porque el div que lo escucha no llega a montarse.
      //
      // El precio, que no es cero: una sesión de emulador YA asignada a un
      // juego (la bandeja Pending deja asignarlas en caliente) sí tendría
      // contenido que pintar, y tampoco arma el overlay. Desde aquí no hay
      // forma de distinguirlas — el callback solo trae títulos y
      // getActiveGameIds() solo mira las claves "game:". El `?? 0` es
      // inalcanzable: quien llama es el propio watcher.
      handleOverlayActiveGames(appState.watcher?.getActiveGameIds().length ?? 0);
    },
    // Sync rápido antes de crear un playthrough (§10.7). Por cierre perezoso:
    // sin hub emparejado (o en E2E) resuelve al instante.
    {
      syncBeforeCreate: (limitMs) =>
        appState.syncRuntime?.syncOnceWithin(limitMs) ?? Promise.resolve(),
    },
  );
  appState.watcher = watcher;
  watcher.start();
  // La guarda de "no restaurar una partida con el juego abierto"
  // (PARTIDAS-GUARDADAS.md §10bis.3) pregunta por aquí — el watcher ya sabe
  // qué está vivo, sin escanear procesos otra vez.
  setRunningGamesProbe((gameId) => appState.watcher?.isGameRunning(gameId) ?? false);
  wireDomainNotifiers();
  wireSessionClosedNotice();

  // Vigilante de las carpetas de juegos (scan/watcher.ts): mantiene al día
  // la caché de "Scan your folders" para que instalar un juego se note solo,
  // sin tener que pedir un escaneo. Igual que el updater, va al final: su
  // trabajo no puede retrasar ni la ventana ni el watcher de procesos.
  const scanWatcher = new ScanWatcher(() => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      emit(mainWindow.webContents, 'scan:changed');
    }
  });
  appState.scanWatcher = scanWatcher;
  setScanWatcher(scanWatcher);
  scanWatcher.start();
  mark('bandeja + watchers en marcha');
}

// auto-actualización (solo app empaquetada — ver updater.ts). Al final
// del arranque a propósito: comprobar una release jamás debe retrasar la
// ventana, el watcher ni el sync.
//
// Y por import() dinámico, no arriba con los demás — que es la parte que el
// párrafo anterior prometía y no cumplía. `electron-updater` cuesta 53 ms de
// require MEDIDOS (el más caro de todo el árbol del main), y un import
// estático se paga al cargar el módulo, o sea ANTES de whenReady: retrasaba
// justo la ventana que esto no debía retrasar. Aquí se paga cuando ya no
// hay nadie esperando.
function startUpdater(): void {
  void import('../updater')
    .then(({ startAutoUpdater }) => startAutoUpdater())
    .catch((error: unknown) => {
      console.warn('[updater] no se pudo arrancar el auto-actualizador:', error);
    });
}

// El arranque completo, en orden. `isPrimaryInstance` viene del candado de
// instancia única (lifecycle/singleInstance.ts).
export const runStartup = async (isPrimaryInstance: boolean): Promise<void> => {
  // La instancia perdedora del candado (§1.1) ya pidió quit — no debe crear
  // splash, ni migrar, ni nada: morir en silencio es todo su trabajo.
  if (!isPrimaryInstance) return;

  startElectronShell();
  loadConfigAndCredentials();
  registerIpcAndCreateWindow();
  if (needsCutover()) await runCutoverPhase();
  else if (!openLocalDb()) return;
  createSyncRuntime();
  revealWindowWhenDbReady();
  createTray();
  startWatchers();
  registerPowerEvents();
  startBackgroundJobs();
  startUpdater();
  registerActivate();
};
