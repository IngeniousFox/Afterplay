import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import icon from '../../resources/icon.png?asset';
import { runMigrations } from './db';
// [SEED] cuando quite el seed: este import + borrar src/main/db/seed.ts.
import { seedDatabase } from './db/seed';
import { registerIpcHandlers } from './ipc';

// Overrides the userData folder name (would otherwise be "afterplay", lowercase,
// taken from package.json's "name"). Must run before any app.getPath('userData')
// call — including the lazy one inside getDb() — so it's the very first thing
// this module does, before app.whenReady() or anything async.
app.setName('Afterplay');

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    minWidth: 1000,
    minHeight: 700,
    show: true,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
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
    dialog.showErrorBox(
      'Afterplay',
      'No se pudo preparar la base de datos. La app se va a cerrar.',
    );
    app.quit();
    return;
  }

  // [SEED] Datos de prueba, solo en dev. Para quitarlo: este bloque + el
  // import de seedDatabase de arriba + borrar src/main/db/seed.ts.
  // Si peta no pasa nada, se loguea y la app sigue tirando igual.
  if (is.dev) {
    try {
      await seedDatabase();
    } catch (error) {
      console.error('[seed] Falló el seed de desarrollo:', error);
    }
  }

  registerIpcHandlers();

  createWindow();

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
