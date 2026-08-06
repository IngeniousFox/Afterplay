import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  shell,
} from 'electron';
import { join } from 'path';
import icon from '../../resources/icon.png?asset';
import { initCredentials } from './config/credentials';
import { runMigrations, runSyncCycle } from './db';
import { runDailyBackup } from './db/dailyBackup';
import type { Tray } from 'electron';
import { registerImageProtocolHandler, registerImageProtocolScheme } from './images/protocol';
import { registerIpcHandlers } from './ipc';
import { registerContextMenu } from './lib/contextMenu';
import { wasOpenedHiddenAtLogin } from './lib/loginItem';
import { createSplashWindow } from './splash/splash';
import { createAppTray, setTrayActiveGames } from './tray/tray';
import { startAutoUpdater } from './updater';
import { getSavedWindowOptions, trackWindowState } from './lib/windowState';
import { setCuriositiesNotifier } from './curiosities/notify';
import { setExternalNotifier } from './external/notify';
import { runMemoriesDailyTick } from './memories/detect';
import { runSteamAppIdBackfill } from './steam/appIdBackfill';
import {
  queueAchievementsRefreshForGame,
  runAchievementsStartupPass,
  runEmuUnlocksSweep,
} from './steam/backfill';
import { setAchievementsNotifier } from './steam/notify';
import { setImagesNotifier } from './images/maintenance';
import { closeAchievementOverlay } from './steam/notifications/overlay';
import { startEmuWatcher, stopEmuWatcher } from './steam/emu/watcher';
import { startSteamLivePoll, stopSteamLivePoll } from './steam/livePoll';
import { runRaStartupPass } from './ra/backfill';
import { startRaLivePoll, stopRaLivePoll } from './ra/livePoll';
import { setMemoriesNotifier } from './memories/notify';
import { setRadarNotifier } from './radar/notify';
import { runRadarTick } from './radar/pass';
import { setSavesNotifier } from './saves/notify';
import { ScanWatcher, setScanWatcher } from './scan/watcher';
import { setSessionClosedNotifier } from './watcher/notifySession';
import { setRunningGamesProbe } from './watcher/runningGames';
import { ProcessWatcher } from './watcher/watcher';

// "1h 47m" para el cuerpo de la notificación de Windows. Aquí y no en
// lib/format del renderer: el main no puede importar del renderer, y son tres
// líneas.
const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

// La ventana principal a nivel de módulo para que el watcher pueda avisarle
// (webContents.send) sin acoplarse a createWindow. Null mientras no exista.
let mainWindow: BrowserWindow | null = null;
// Pantalla de arranque (ver splash/splash.ts) — vive a nivel de módulo para
// que createWindow() (llamada tanto en el arranque como luego desde
// 'activate'/el tray) pueda cerrarla la primera vez que la ventana real
// esté lista, sin necesidad de pasársela como parámetro.
let splashWindow: BrowserWindow | null = null;
let watcher: ProcessWatcher | null = null;
let scanWatcher: ScanWatcher | null = null;
let tray: Tray | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
// Más espaciado que el watcher de procesos (5s) a propósito — sincronizar
// con Turso es una llamada de red de verdad, no un sondeo local barato.
const SYNC_INTERVAL_MS = 60_000;
// El tic de la detección de recaps (AFTERPLAY-LOOP.md §3.3). Cada hora, pero
// el trabajo real solo pasa una vez por día de calendario (ver
// memories/detect.ts) — el intervalo corto es solo para no perder el cambio
// de día por mucho que la app viva en la bandeja.
let memoriesTimer: ReturnType<typeof setInterval> | null = null;
const MEMORIES_TICK_MS = 60 * 60 * 1000;
// SPEC 3E — el botón X de la ventana oculta, no cierra: solo "Quit" del tray
// (o antes de la propia app.quit(), en before-quit) marca esto para dejar
// pasar el cierre real. Sin esto, la app no podría cerrarse nunca de verdad.
let isQuitting = false;
// Arranque a bandeja con estado guardado "maximizada": la ventana queda
// oculta SIN maximizar (maximize() sobre una ventana oculta la muestra, ver
// ready-to-show) — esta marca lo deja pendiente para la primera apertura
// desde el tray.
let pendingMaximize = false;
// Notificaciones nativas todavía en pantalla. Electron NO retiene sus propias
// Notification: sin una referencia viva desde JS, el recolector se lleva el
// objeto en cuanto el callback que lo creó termina, y con él sus manejadores
// de eventos — el aviso aparecía pero pulsarlo no hacía nada.
const liveNotifications = new Set<Notification>();
// ── Big Picture (BIG-PICTURE.md) ─────────────────────────────────────────
// El modo TV vive en el MAIN como fuente de verdad: tres de sus cuatro
// disparadores nacen aquí (argv en frío, second-instance, F11) y el
// fullscreen es cosa de este proceso. El renderer se suscribe
// (bigpicture:changed) y consulta al montar (bigpicture:get) — mismo patrón
// y misma lección de carreras que window:visible-change.
let bigPictureMode = process.argv.includes('--bigpicture');
// La foto de la ventana ANTES de entrar al modo, para devolverla igual al
// salir (fullscreen pisa bounds y maximizado).
let preBigPictureState: { bounds: Electron.Rectangle; isMaximized: boolean } | null = null;

// Overrides the userData folder name (would otherwise be "afterplay", lowercase,
// taken from package.json's "name"). Must run before any app.getPath('userData')
// call — including the lazy one inside getDb() — so it's the very first thing
// this module does, before app.whenReady() or anything async.
app.setName('Afterplay');

// El aviso de logros suena SIN que nadie haya pulsado nada en su ventana — y
// no puede pulsarse, porque ignora el ratón a propósito (LOGROS.md §8). Sin
// esto, la política de autoreproducción de Chromium deja su AudioContext
// suspendido y el aviso sale mudo. Tiene que ir antes de whenReady().
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// También tiene que ir antes de whenReady() — Electron lo exige para poder
// registrar esquemas con privilegios (ver images/protocol.ts).
registerImageProtocolScheme();

// BIG-PICTURE.md §1 — instancia única, ANTES de tocar nada más. Sin esto,
// un doble clic con la app viva en la bandeja arrancaba una segunda app
// entera que moría contra el fichero de la DB con un error que culpaba a la
// base de datos de lo que solo era "ya estabas abierta". La segunda
// instancia ahora es un mensajero: entrega sus argv a la primera por
// 'second-instance' y se va en milisegundos, sin ventana ni DB.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // El caso Moonlight (BIG-PICTURE.md §2): `Afterplay.exe --bigpicture`
    // con la app ya corriendo = la primera instancia se pone en modo TV.
    // Sin el argumento, el clásico "doble clic": traerla delante y ya.
    if (argv.includes('--bigpicture')) {
      enterBigPicture();
    } else {
      showMainWindow();
    }
  });
}

function createWindow(): void {
  // Si Windows/macOS arrancó la app sola por el login item, no se enseña la
  // ventana — arranca directa a la bandeja (SPEC 3E). Ver lib/loginItem.ts
  // para el porqué esto no es tan simple como parece en Windows.
  // `--bigpicture` GANA sobre el arranque oculto (BIG-PICTURE.md §2): si
  // pediste el modo TV, lo que quieres es pantalla, no bandeja.
  const wasOpenedAtLogin = wasOpenedHiddenAtLogin() && !bigPictureMode;

  // Mismo tamaño/posición que tenía al cerrarla la última vez (o el de
  // siempre si es la primera vez, o si el monitor de entonces ya no está
  // conectado) — ver lib/windowState.ts.
  const { x, y, width, height, isMaximized } = getSavedWindowOptions();

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    // Arranque en frío con --bigpicture (o ventana recreada con el modo ya
    // activo): nace directamente a pantalla completa, sin parpadeo de
    // ventana normal por medio.
    fullscreen: bigPictureMode,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  const window = mainWindow;
  trackWindowState(window);

  window.on('ready-to-show', () => {
    // Se cierra aquí y no antes: este es el primer momento en que la
    // ventana real tiene algo pintado que enseñar en su lugar. En llamadas
    // posteriores a createWindow() (activate del dock, tray) splashWindow ya
    // está a null — cerrar null no hace nada.
    splashWindow?.close();
    splashWindow = null;
    // maximize() AQUÍ y no nada más crear la ventana: en Windows, maximizar
    // una ventana oculta (show: false) la MUESTRA — con el estado guardado
    // en maximizado, aparecía una ventana blanca a pantalla completa (sin
    // contenido cargado aún) conviviendo con el splash. En el arranque a
    // bandeja (wasOpenedAtLogin) ni se maximiza: la ventana sigue oculta y
    // queda pendingMaximize para cuando se abra desde el tray.
    if (!wasOpenedAtLogin) {
      if (isMaximized) window.maximize();
      window.show();
    } else {
      pendingMaximize = isMaximized;
    }
  });

  window.on('maximize', () => {
    window.webContents.send('window:maximized-change', true);
  });

  window.on('unmaximize', () => {
    window.webContents.send('window:maximized-change', false);
  });

  // F11 (o el menú por defecto de Electron, que ya lo trae aunque no se
  // registre nada aquí) pone la ventana en fullscreen de VERDAD a nivel de
  // SO — pero nuestra TitleBar sigue siendo contenido normal de la página, no
  // chrome del sistema, así que sin este aviso se quedaba flotando encima de
  // un fullscreen que se suponía sin nada alrededor.
  window.on('enter-full-screen', () => {
    window.webContents.send('window:fullscreen-change', true);
  });

  window.on('leave-full-screen', () => {
    window.webContents.send('window:fullscreen-change', false);
  });

  // El modo ambiente no debe encenderse si no hay nadie delante de la
  // pantalla para verlo: minimizada o mandada a la bandeja, la app sigue viva
  // vigilando procesos (por eso sigue existiendo sin ventana), pero el
  // renderer no tenía forma de saberlo — su temporizador de inactividad solo
  // mira eventos de ratón/teclado, y sin ventana visible esos eventos
  // simplemente no llegan nunca, así que contaba como "inactivo" igual. Se
  // avisa en los cuatro eventos que pueden cambiar la visibilidad real: el
  // botón _ minimiza, "Open" del tray restaura, y close/el propio tray
  // ocultan/muestran sin pasar por minimizar.
  //
  // Cada evento manda el valor que ÉL MISMO significa, sin releer
  // isMinimized()/isVisible() dentro del manejador: en Windows el evento
  // 'minimize' puede dispararse ANTES de que el estado interno cambie, así
  // que preguntarle a la ventana en ese instante respondía "no está
  // minimizada" y el renderer se quedaba creyendo la ventana visible — con
  // el modo ambiente encendiéndose de fondo con la app minimizada. Del eje
  // que NO cambia en el evento sí se puede preguntar: ese no está en vuelo.
  const sendVisibility = (visible: boolean): void => {
    window.webContents.send('window:visible-change', visible);
  };
  window.on('minimize', () => sendVisibility(false));
  window.on('hide', () => sendVisibility(false));
  // 'restore' des-minimiza: visible salvo que además estuviera oculta.
  window.on('restore', () => sendVisibility(window.isVisible()));
  // 'show' des-oculta: visible salvo que además estuviera minimizada.
  window.on('show', () => sendVisibility(!window.isMinimized()));

  // SPEC 3E — la X minimiza a la bandeja, no cierra la app (que sigue viva
  // vigilando procesos). isQuitting se marca en before-quit (cualquier vía de
  // cierre real: menú "Quit" del tray, apagado del sistema...) para dejar
  // pasar el cierre de verdad en ese caso, o esto bloquearía la app para
  // siempre.
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  // F11 = entrar/salir de Big Picture (BIG-PICTURE.md §2). El accelerator de
  // fullscreen que regalaba el menú por defecto ya no existe (el menú se
  // anula en whenReady), así que la tecla se captura aquí — y NO con
  // globalShortcut: F11 solo debe actuar con Afterplay enfocada, no
  // robarle la tecla al resto del sistema.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleBigPicture();
    }
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  registerContextMenu(window);

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Traer la app delante, venga de donde venga la petición: el "Open" del
// tray, el clic en una notificación, o una segunda instancia (doble clic /
// Moonlight). Antes esta lógica estaba duplicada en cada sitio, con el
// pendingMaximize resuelto tres veces (BIG-PICTURE.md §1.1).
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (pendingMaximize) {
    pendingMaximize = false;
    mainWindow.maximize();
  } else {
    mainWindow.show();
  }
  mainWindow.focus();
}

// ── Big Picture: entrar / salir / avisar (BIG-PICTURE.md §2-§4) ──────────
function sendBigPictureState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bigpicture:changed', bigPictureMode);
  }
}

function enterBigPicture(): void {
  bigPictureMode = true;
  // Traerla delante ANTES de la foto: así lo que se guarda para restaurar
  // es la ventana visible como estaba (maximizado del pendingMaximize
  // incluido), no un estado a medias desde la bandeja.
  showMainWindow();
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    if (!window.isFullScreen()) {
      preBigPictureState = { bounds: window.getBounds(), isMaximized: window.isMaximized() };
      window.setFullScreen(true);
    }
  }
  // Se avisa aunque el modo ya estuviera activo: un renderer recién cargado
  // (ventana recreada) puede haberse perdido el aviso anterior, y repetirlo
  // es inofensivo.
  sendBigPictureState();
}

function exitBigPicture(): void {
  if (!bigPictureMode) return;
  bigPictureMode = false;
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.setFullScreen(false);
    const previous = preBigPictureState;
    if (previous) {
      if (previous.isMaximized) window.maximize();
      else window.setBounds(previous.bounds);
    }
  }
  preBigPictureState = null;
  sendBigPictureState();
}

function toggleBigPicture(): void {
  if (bigPictureMode) exitBigPicture();
  else enterBigPicture();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // La instancia perdedora del candado (§1.1) ya pidió quit — no debe crear
  // splash, ni migrar, ni nada: morir en silencio es todo su trabajo.
  if (!isPrimaryInstance) return;

  // Sin menú de aplicación: era invisible (frame:false + autoHideMenuBar)
  // y solo aportaba accelerators fantasma — el F11 de fullscreen que ahora
  // es el toggle de Big Picture (ver before-input-event en createWindow).
  // F12/Ctrl+R de desarrollo no viven aquí (los pone watchWindowShortcuts).
  Menu.setApplicationMenu(null);

  // Splash — tan pronto como Electron deja crear ventanas, antes de nada
  // más (migraciones, conexión con Turso, arranque del bundle del
  // renderer...). Si la app la abrió Windows sola al iniciar sesión, no
  // hay nada que enseñar todavía (arranca directa a la bandeja, SPEC 3E) —
  // mismo chequeo que createWindow() usa para decidir si mostrarse, con la
  // misma excepción: --bigpicture quiere pantalla.
  if (!wasOpenedHiddenAtLogin() || bigPictureMode) splashWindow = createSplashWindow();

  // Identidad de la app para Windows. TIENE que coincidir con el appId de
  // electron-builder.yml (com.afterplay.app): Windows resuelve el nombre que
  // enseña en las notificaciones buscando este identificador en el acceso
  // directo que crea el instalador. Con el 'com.electron' de la plantilla no
  // encontraba nada y caía a la ruta del ejecutable — de ahí el
  // "D:\...\node_modules\electron..." como título del aviso.
  //
  // En desarrollo puede seguir saliendo la ruta: se lanza electron.exe a pelo
  // y no hay acceso directo instalado con este id contra el que resolver.
  electronApp.setAppUserModelId('com.afterplay.app');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Credenciales (Twitch/IGDB, SteamGridDB, Turso) del almacén cifrado de
  // userData a process.env — TIENE que ir tras whenReady (safeStorage lo
  // exige) y antes de runMigrations (la conexión con Turso las lee ahí).
  // Sin ninguna configurada la app arranca igual, en modo local: las claves
  // se meten desde Ajustes y se aplican en caliente, sin reiniciar.
  try {
    initCredentials();
  } catch (error) {
    console.warn('[credentials] fallo cargando credenciales (sigo sin ellas):', error);
  }

  // Apply pending DB migrations before anything else touches the database.
  // A failed migration means the app can't run correctly, so it quits
  // instead of continuing into a broken state.
  try {
    await runMigrations();
  } catch (error) {
    console.error('Database migration failed:', error);
    splashWindow?.close();
    // Con la instancia única (§1.1), "la app ya estaba abierta" ha dejado de
    // ser una causa posible de este error — el texto ya no la enmascara y
    // puede señalar a los culpables reales que quedan.
    dialog.showErrorBox(
      'Afterplay',
      'No se pudo preparar la base de datos (¿otro programa está usando el archivo, o falló una migración?). La app se va a cerrar.',
    );
    app.quit();
    return;
  }

  // Sin await: VACUUM INTO copia el fichero .db entero y con una biblioteca
  // grande puede tardar un buen puñado de segundos — nada de lo que sigue
  // (handlers IPC, la ventana) depende de que esta copia exista ya, así que
  // esperarla aquí solo retrasaba el primer pintado sin ganar nada. Ahora
  // corre en paralelo, gateada por su propio withDbAccess (ver dailyBackup.ts).
  void runDailyBackup().catch((error: unknown) => {
    console.warn('[backup] fallo inesperado en la copia diaria (sigo igualmente):', error);
  });

  registerIpcHandlers();
  registerImageProtocolHandler();

  // IPC de Big Picture y del quit real, registrados AQUÍ y no en ipc/ — su
  // estado (bigPictureMode, isQuitting) vive en este módulo, que es el dueño
  // del ciclo de vida de la ventana.
  ipcMain.handle('bigpicture:get', () => bigPictureMode);
  ipcMain.on('bigpicture:enter', () => enterBigPicture());
  ipcMain.on('bigpicture:exit', () => exitBigPicture());
  // El "Quit Afterplay" del menú del modo TV: el MISMO cierre real que el
  // "Quit" del tray — sin marcar isQuitting, el interceptor de la X lo
  // convertiría en un simple esconderse a la bandeja.
  ipcMain.on('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  createWindow();

  // Bandeja del sistema (SPEC 3E): icono persistente con "Open"/"Quit" — la
  // app sigue vigilando procesos aunque la ventana esté oculta, y solo se
  // cierra de verdad desde aquí.
  tray = createAppTray({
    // La misma puerta que la segunda instancia y la notificación: traerla
    // delante con el pendingMaximize resuelto (ver showMainWindow).
    onOpen: showMainWindow,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  // Watcher de procesos (Bloque 3): vigila los juegos armados (con
  // executablePath y playthrough activo) y registra sesiones automáticas.
  // Recibe un getter de la ventana en vez de la ventana directa porque esta
  // se recrea (macOS 'activate') y se destruye ('closed'). El segundo
  // parámetro (opcional, SPEC 3E) mantiene el tooltip del tray al día con lo
  // que esté en marcha ahora mismo, sin tener que abrir la ventana.
  watcher = new ProcessWatcher(
    () => mainWindow,
    (titles) => {
      if (tray) setTrayActiveGames(tray, titles);
    },
  );
  watcher.start();
  // La guarda de "no restaurar una partida con el juego abierto"
  // (PARTIDAS-GUARDADAS.md §10bis.3) pregunta por aquí — el watcher ya sabe
  // qué está vivo, sin escanear procesos otra vez.
  setRunningGamesProbe((gameId) => watcher?.isGameRunning(gameId) ?? false);
  // Copias automáticas al cerrar sesión: el renderer necesita enterarse en
  // vivo, o la ficha abierta se queda con la foto de antes (§10.2).
  setSavesNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('saves:activity', event);
    }
  });
  // Generación de curiosidades (backfill de Ajustes y altas nuevas): el
  // renderer necesita el progreso en vivo y el aviso de "este juego ya tiene
  // las suyas" para refrescar sin sondear nada.
  setCuriositiesNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('curiosities:activity', event);
    }
  });
  // Recaps del Loop (AFTERPLAY-LOOP.md §3): mismo canal de progreso que las
  // curiosidades, y el aviso de "tu junio ya está contado" con el que el
  // renderer levanta su toast de aterrizaje.
  setMemoriesNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memories:activity', event);
    }
  });
  // Logros (LOGROS.md): mismo canal de progreso que las curiosidades y los
  // recaps — la ficha abierta y la tarjeta de Ajustes se refrescan solas.
  setAchievementsNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('achievements:activity', event);
    }
  });
  // Datos externos (PLAN-TO-PLAY.md §5): la parte de SteamSpy va a ~1
  // petición por segundo, así que una pasada dura minutos — más de lo que
  // cualquiera deja Ajustes abierto. Por eso su estado es del main y viaja
  // por aquí: cerrar el modal o cambiar de pantalla no la para ni la pierde.
  setExternalNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('external:activity', event);
    }
  });
  // El radar de secuelas (PLAN-TO-PLAY.md §4.4): un aviso agrupado cuando la
  // pasada semanal encuentra entregas nuevas de tus sagas.
  setRadarNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('radar:activity', event);
    }
  });
  // Redescarga de la caché de imágenes (Ajustes → Images): miles de ficheros
  // en una pasada, así que el progreso va por evento como todo lo largo.
  setImagesNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('images:activity', event);
    }
  });

  // Cierre de un juego: el aviso va por una vía u otra según DÓNDE puedas
  // verlo. Con la ventana a la vista, un toast dentro de la app (Sonner);
  // con la app en la bandeja —que es el caso normal mientras juegas— una
  // notificación nativa de Windows, porque un toast en una ventana oculta no
  // lo vería nadie. Las dos llevan al mismo sitio: la ficha del juego con su
  // última sesión resaltada.
  setSessionClosedNotifier((event) => {
    // Acabas de cerrar el juego: sus logros son lo único que puede haber
    // cambiado, y este es el momento de recogerlos (LOGROS.md §4) — tanto de
    // la API de Steam como de los ficheros que el crack acabe de escribir.
    void queueAchievementsRefreshForGame(event.gameId);

    const window = mainWindow;
    if (window && !window.isDestroyed() && window.isVisible()) {
      window.webContents.send('sessions:closed', event);
      return;
    }

    if (!Notification.isSupported()) return;
    // Con sonido (el de Windows por defecto): esto avisa de algo que acaba de
    // pasar mientras NO estabas mirando la app — un aviso mudo en una ventana
    // oculta es un aviso que no existe.
    const notification = new Notification({
      title: event.gameTitle,
      body: `${formatDuration(event.durationSec)} played${
        event.isLongest ? ' · your longest session yet' : ''
      }`,
    });

    // RETENER la notificación mientras esté en pantalla. Sin esto, en cuanto
    // este callback termina el objeto queda sin referencias, el recolector se
    // lo lleva y con él su manejador de 'click' — el aviso se veía pero
    // pulsarlo no hacía absolutamente nada. En Windows la notificación
    // sobrevive en el centro de actividades bastante después de mostrarse, así
    // que la ventana para que esto pase es enorme.
    liveNotifications.add(notification);
    const release = (): void => {
      liveNotifications.delete(notification);
    };
    notification.on('close', release);
    notification.on('failed', release);

    notification.on('click', () => {
      release();
      // Traer la ventana Y llevarla a la ficha: llegar a la biblioteca
      // genérica obligaría a buscar el juego a mano justo cuando el aviso
      // acaba de decirte cuál es.
      showMainWindow();
      const target = mainWindow;
      if (!target) return;

      // La ventana puede acabar de crearse (app arrancada a bandeja y nunca
      // abierta): mandar el evento antes de que el renderer cargue lo tira al
      // vacío. Con 'did-finish-load' ya hay quien escuche.
      if (target.webContents.isLoading()) {
        target.webContents.once('did-finish-load', () => {
          target.webContents.send('sessions:closed', { ...event, openGame: true });
        });
      } else {
        target.webContents.send('sessions:closed', { ...event, openGame: true });
      }
    });
    notification.show();
  });

  // Vigilante de las carpetas de juegos (scan/watcher.ts): mantiene al día
  // la caché de "Scan your folders" para que instalar un juego se note solo,
  // sin tener que pedir un escaneo. Igual que el updater, va al final: su
  // trabajo no puede retrasar ni la ventana ni el watcher de procesos.
  scanWatcher = new ScanWatcher(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:changed');
    }
  });
  setScanWatcher(scanWatcher);
  scanWatcher.start();

  // Bloque 3G — bloquear/suspender el PC no es tiempo jugado, siga el
  // proceso vivo detrás o no. 'lock-screen'/'resume' son Windows (Win+L,
  // pantalla de bloqueo); 'suspend'/'resume' cubren además Mac/Linux y el
  // suspendido real de Windows. Los cuatro apuntan a pause()/resume(), que ya
  // son idempotentes (no pasa nada si se disparan los dos a la vez, ej. al
  // cerrar la tapa del portátil).
  powerMonitor.on('suspend', () => watcher?.pause());
  powerMonitor.on('lock-screen', () => watcher?.pause());
  powerMonitor.on('resume', () => watcher?.resume());
  powerMonitor.on('unlock-screen', () => watcher?.resume());

  // Sync con Turso (Bloque 4): la conexión decidió si tiene sync o no al
  // arrancar (dentro de runMigrations()). Si arrancó sin red, cada ciclo
  // reintenta el ascenso en caliente (con el candado de withDbAccess — ver
  // db/index.ts); con sync activo, solo sube/baja cambios. El primer ciclo
  // se lanza ya mismo (sin esperar el intervalo) — "sync manual al
  // arrancar" — sin bloquear el resto del arranque.
  // Detección automática de recaps pendientes (AFTERPLAY-LOOP.md §3.3): una
  // pasada al arrancar y un tic horario que solo trabaja una vez por día de
  // calendario — la app vive semanas en la bandeja sin reiniciarse y el
  // cambio de mes tiene que notarse solo. Encadenada tras el PRIMER sync a
  // propósito: si el otro PC ya generó junio, el sync lo baja y aquí ni se
  // paga de nuevo. (Y si el sync falla, el tic horario la recoge — la
  // carrera de dos PCs generando a la vez la absorbe el upsert, §7.1.)
  // El backfill de appids de Steam (LOGROS.md) cuelga del mismo primer sync
  // que los recaps, por el mismo motivo: si el otro PC ya lo hizo, aquí no
  // queda nada que preguntar. Tras la primera pasada es un no-op.
  void runSyncCycle().then(async () => {
    void runMemoriesDailyTick();
    // El radar mira si toca (una vez por semana) y no hace nada el resto de
    // los arranques — la comprobacion es leer una fecha de config.json.
    void runRadarTick();
    // El catálogo de logros necesita el appid, así que va DESPUÉS del
    // backfill de appids y no en paralelo: un juego cuyo appid acaba de
    // llegar entra en la misma pasada en vez de esperar al próximo arranque.
    await runSteamAppIdBackfill();
    void runAchievementsStartupPass();
    // Y el barrido de emuladores (LOGROS.md §7): disco local puro, recoge lo
    // que los cracks apuntaron con la app cerrada. Después queda la
    // vigilancia en vivo, que es la que los pilla mientras juegas.
    await runEmuUnlocksSweep();
    startEmuWatcher();
    // RetroAchievements (RETROACHIEVEMENTS.md): emparejado + catálogos de lo
    // emulado retro, y su sondeo en vivo — que solo pregunta mientras el
    // watcher vea un emulador corriendo.
    void runRaStartupPass();
    startRaLivePoll(() => watcher?.hasActiveEmulator() ?? false);
    // Y el gemelo para Steam: los logros del juego que estés jugando AHORA,
    // sin esperar a cerrarlo. Solo pregunta mientras el watcher vea juegos
    // corriendo, igual que el de RA con los emuladores.
    startSteamLivePoll(() => watcher?.getActiveGameIds() ?? []);
  });
  syncTimer = setInterval(() => void runSyncCycle(), SYNC_INTERVAL_MS);
  memoriesTimer = setInterval(() => {
    void runMemoriesDailyTick();
    // Mismo tic para el radar: la app puede pasar semanas sin reiniciarse
    // (vive en la bandeja), asi que mirarlo solo al arrancar no basta.
    void runRadarTick();
  }, MEMORIES_TICK_MS);

  // Auto-actualización (solo app empaquetada — ver updater.ts). Al final del
  // arranque a propósito: comprobar una release jamás debe retrasar la
  // ventana, el watcher ni el sync.
  startAutoUpdater();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
app.on('before-quit', () => {
  isQuitting = true;
  watcher?.stop();
  scanWatcher?.stop();
  // La ventana del aviso de logros vive fuera del ciclo de la principal: sin
  // esto, una tarjeta en pantalla al salir mantendría el proceso vivo.
  closeAchievementOverlay();
  stopEmuWatcher();
  stopRaLivePoll();
  stopSteamLivePoll();
  if (syncTimer) clearInterval(syncTimer);
  if (memoriesTimer) clearInterval(memoriesTimer);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
