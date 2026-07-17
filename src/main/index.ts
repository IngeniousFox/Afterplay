import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { config as loadDotenv } from 'dotenv';
import { app, BrowserWindow, dialog, powerMonitor, shell } from 'electron';
import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import icon from '../../resources/icon.png?asset';
import { runMigrations, runSyncCycle } from './db';
import { runDailyBackup } from './db/dailyBackup';
import type { Tray } from 'electron';
import { registerImageProtocolHandler, registerImageProtocolScheme } from './images/protocol';
import { registerIpcHandlers } from './ipc';
import { wasOpenedHiddenAtLogin } from './lib/loginItem';
import { createSplashWindow } from './splash/splash';
import { createAppTray, setTrayActiveGames } from './tray/tray';
import { ProcessWatcher } from './watcher/watcher';

// La ventana principal a nivel de módulo para que el watcher pueda avisarle
// (webContents.send) sin acoplarse a createWindow. Null mientras no exista.
let mainWindow: BrowserWindow | null = null;
// Pantalla de arranque (ver splash/splash.ts) — vive a nivel de módulo para
// que createWindow() (llamada tanto en el arranque como luego desde
// 'activate'/el tray) pueda cerrarla la primera vez que la ventana real
// esté lista, sin necesidad de pasársela como parámetro.
let splashWindow: BrowserWindow | null = null;
let watcher: ProcessWatcher | null = null;
let tray: Tray | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
// Más espaciado que el watcher de procesos (5s) a propósito — sincronizar
// con Turso es una llamada de red de verdad, no un sondeo local barato.
const SYNC_INTERVAL_MS = 60_000;
// SPEC 3E — el botón X de la ventana oculta, no cierra: solo "Quit" del tray
// (o antes de la propia app.quit(), en before-quit) marca esto para dejar
// pasar el cierre real. Sin esto, la app no podría cerrarse nunca de verdad.
let isQuitting = false;

// Overrides the userData folder name (would otherwise be "afterplay", lowercase,
// taken from package.json's "name"). Must run before any app.getPath('userData')
// call — including the lazy one inside getDb() — so it's the very first thing
// this module does, before app.whenReady() or anything async.
app.setName('Afterplay');

// Credenciales (.env: Turso, Twitch/IGDB, SteamGridDB) en process.env antes
// de que nada las lea — todo el código las consulta en el momento de usarlas
// (hasRemoteConfigured, getCredentials...), nunca al importar, así que basta
// con cargarlas aquí, ya con el nombre de la app fijado.
//
// La app INSTALADA lee %APPDATA%/Afterplay/.env: el instalador no empaqueta
// el .env a propósito (electron-builder.yml lo excluye — secretos fuera del
// asar) y el cwd de una app instalada no es el proyecto, así que sin esa
// copia arrancaría sin Turso ni IGDB en silencio. Es la misma carpeta donde
// ya viven la DB y config.json, y sobrevive a reinstalaciones.
//
// En DESARROLLO se lee el .env del proyecto (la fuente de verdad) y se
// REFRESCA la copia de %APPDATA% en cada arranque — así rotar un token en el
// proyecto se propaga a la app instalada con solo arrancar dev una vez,
// sin tener que acordarse de copiarlo a mano.
const userDataEnvPath = join(app.getPath('userData'), '.env');
if (app.isPackaged) {
  loadDotenv({ path: userDataEnvPath });
} else {
  loadDotenv();
  const projectEnvPath = join(process.cwd(), '.env');
  if (existsSync(projectEnvPath)) {
    try {
      copyFileSync(projectEnvPath, userDataEnvPath);
    } catch (error) {
      console.warn('[env] no se pudo refrescar la copia de .env en userData:', error);
    }
  }
}

// También tiene que ir antes de whenReady() — Electron lo exige para poder
// registrar esquemas con privilegios (ver images/protocol.ts).
registerImageProtocolScheme();

function createWindow(): void {
  // Si Windows/macOS arrancó la app sola por el login item, no se enseña la
  // ventana — arranca directa a la bandeja (SPEC 3E). Ver lib/loginItem.ts
  // para el porqué esto no es tan simple como parece en Windows.
  const wasOpenedAtLogin = wasOpenedHiddenAtLogin();

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  const window = mainWindow;

  window.on('ready-to-show', () => {
    // Se cierra aquí y no antes: este es el primer momento en que la
    // ventana real tiene algo pintado que enseñar en su lugar. En llamadas
    // posteriores a createWindow() (activate del dock, tray) splashWindow ya
    // está a null — cerrar null no hace nada.
    splashWindow?.close();
    splashWindow = null;
    if (!wasOpenedAtLogin) window.show();
  });

  window.on('maximize', () => {
    window.webContents.send('window:maximized-change', true);
  });

  window.on('unmaximize', () => {
    window.webContents.send('window:maximized-change', false);
  });

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

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Splash — tan pronto como Electron deja crear ventanas, antes de nada
  // más (migraciones, conexión con Turso, arranque del bundle del
  // renderer...). Si la app la abrió Windows sola al iniciar sesión, no
  // hay nada que enseñar todavía (arranca directa a la bandeja, SPEC 3E) —
  // mismo chequeo que createWindow() usa para decidir si mostrarse.
  if (!wasOpenedHiddenAtLogin()) splashWindow = createSplashWindow();

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Apply pending DB migrations before anything else touches the database.
  // A failed migration means the app can't run correctly, so it quits
  // instead of continuing into a broken state.
  try {
    await runMigrations();
  } catch (error) {
    console.error('Database migration failed:', error);
    splashWindow?.close();
    dialog.showErrorBox(
      'Afterplay',
      'No se pudo preparar la base de datos. La app se va a cerrar.',
    );
    app.quit();
    return;
  }

  try {
    await runDailyBackup();
  } catch (error) {
    console.warn('[backup] fallo inesperado en la copia diaria (sigo igualmente):', error);
  }

  registerIpcHandlers();
  registerImageProtocolHandler();

  createWindow();

  // Bandeja del sistema (SPEC 3E): icono persistente con "Open"/"Quit" — la
  // app sigue vigilando procesos aunque la ventana esté oculta, y solo se
  // cierra de verdad desde aquí.
  tray = createAppTray({
    onOpen: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    },
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
  void runSyncCycle();
  syncTimer = setInterval(() => void runSyncCycle(), SYNC_INTERVAL_MS);

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
  if (syncTimer) clearInterval(syncTimer);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
