import { app, BrowserWindow, ipcMain } from 'electron';
import { isReadOnly, onCutoverChange } from '../db/readOnly';

export const registerWindowHandlers = (): void => {
  // Modo solo lectura del puente 1.8 (la biblioteca se migró a la 2.0): el
  // banner del renderer lo pide en frío al montar y escucha los cambios. Mismo
  // contrato que window:is-visible — la consulta cubre lo ocurrido antes de
  // montar, el aviso lo posterior.
  ipcMain.handle('library:is-read-only', () => isReadOnly());
  onCutoverChange((info) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send('library:read-only-changed', info !== null);
    }
  });

  // La versión instalada, para el pie de Ajustes — app.getVersion() lee
  // package.json (o el manifest del build empaquetado), así que nunca hay que
  // acordarse de mantener este número sincronizado a mano en ningún otro
  // sitio: sube solo con cada release (ver scripts/release.ts).
  ipcMain.handle('window:get-version', () => app.getVersion());

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
