import { BrowserWindow, ipcMain } from 'electron';

export const registerWindowHandlers = (): void => {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // Estado de visibilidad REAL a demanda, para el arranque del renderer. Los
  // avisos de window:visible-change solo salen cuando algo CAMBIA — si la app
  // arranca directa a la bandeja (login item), la ventana nace oculta sin
  // pasar por ningún evento y el renderer se quedaría con su valor por
  // defecto ("visible") para siempre. Aquí no hay carrera de eventos: se
  // consulta en frío, con el estado ya asentado.
  ipcMain.handle('window:is-visible', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window !== null && window.isVisible() && !window.isMinimized();
  });
};
