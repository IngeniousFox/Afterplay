import { getMainWindow, showMainWindow } from './mainWindow';

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

export const isBigPictureMode = (): boolean => bigPictureMode;

// El reveal de la ventana (windows/mainWindow.ts) lo activa cuando una segunda
// instancia pidió el modo TV durante el arranque.
export const setBigPictureMode = (value: boolean): void => {
  bigPictureMode = value;
};

// ── Big Picture: entrar / salir / avisar (BIG-PICTURE.md §2-§4) ──────────
export function sendBigPictureState(): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bigpicture:changed', bigPictureMode);
  }
}

export function enterBigPicture(): void {
  bigPictureMode = true;
  // Traerla delante ANTES de la foto: así lo que se guarda para restaurar
  // es la ventana visible como estaba (maximizado del pendingMaximize
  // incluido), no un estado a medias desde la bandeja.
  showMainWindow();
  const window = getMainWindow();
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

export function exitBigPicture(): void {
  if (!bigPictureMode) return;
  bigPictureMode = false;
  const window = getMainWindow();
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

export function toggleBigPicture(): void {
  if (bigPictureMode) exitBigPicture();
  else enterBigPicture();
}
