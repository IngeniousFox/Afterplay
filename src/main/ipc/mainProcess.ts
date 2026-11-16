import { handle, on } from './contractHandlers';
import { quitApp } from '../lifecycle/quit';
import { enterBigPicture, exitBigPicture, isBigPictureMode } from '../windows/bigPicture';
import { onStartupContentReady } from '../windows/mainWindow';

// IPC cuyo estado vive en el proceso principal (la ventana, el modo TV, el
// cierre real) y no en ipc/<dominio>.ts. Se registran desde el arranque, cada
// uno en su sitio del orden (ver bootstrap/startup.ts).

// El tercer reloj de la ventana (ver startupContentPainted en
// windows/mainWindow.ts). Se registra ANTES del candado de instancia única.
export const registerStartupContentIpc = (): void => {
  on('window:startup-content-ready', () => {
    onStartupContentReady();
  });
};

// IPC de Big Picture y del quit real, registrados aparte de registerIpcHandlers
// — su estado (bigPictureMode, isQuitting) vive en windows/ y lifecycle/.
export const registerBigPictureIpc = (): void => {
  handle('bigpicture:get', () => isBigPictureMode());
  on('bigpicture:enter', () => enterBigPicture());
  on('bigpicture:exit', () => exitBigPicture());
  // El "Quit Afterplay" del menú del modo TV: el MISMO cierre real que el
  // "Quit" del tray — sin marcar isQuitting, el interceptor de la X lo
  // convertiría en un simple esconderse a la bandeja.
  on('app:quit', () => {
    quitApp();
  });
};
