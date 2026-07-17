import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getDirectorySize } from '../lib/directorySize';

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

  // Campo "Install directory" (Add/Edit game) — al elegir la carpeta se
  // calcula su tamaño en el sitio, para no tener que recorrerla de nuevo
  // cada vez que se abre el detalle del juego.
  ipcMain.handle('dialog:pickDirectory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;

    const path = result.filePaths[0];
    const sizeBytes = await getDirectorySize(path);
    return { path, sizeBytes };
  });

  // Botón "Back up now" de Ajustes — a diferencia de pickDirectory, no hace
  // falta el tamaño de la carpeta elegida, así que no vale la pena pagar el
  // recorrido de getDirectorySize por algo que se va a ignorar.
  ipcMain.handle('dialog:pickFolder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
