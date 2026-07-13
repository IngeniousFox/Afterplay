import { BrowserWindow, dialog, ipcMain } from 'electron';

export const registerDialogHandlers = (): void => {
  // Bloque 2F — botón "Browse" del campo Executable path. Filtro solo en
  // Windows: en dev el propio Electron.exe también tiene extensión .exe, así
  // que restringir el filtro no cuesta nada y evita que el usuario pique un
  // .dll o un acceso directo por error.
  ipcMain.handle('dialog:pickExecutable', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
