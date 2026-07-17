import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getDirectorySize } from '../lib/directorySize';

// Los tres handlers de abajo abren un diálogo nativo de "elegir archivo/
// carpeta" con el mismo patrón (resolver la ventana dueña del evento,
// mostrar el diálogo sobre ella si existe, y tratar cancelar/sin selección
// como "nada") — esto es justo esa parte común, cada handler solo aporta sus
// propias options y qué hacer con la ruta elegida.
const showPicker = async (
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
): Promise<string | null> => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
};

export const registerDialogHandlers = (): void => {
  // Bloque 2F — botón "Browse" del campo Executable path. Filtro solo en
  // Windows: en dev el propio Electron.exe también tiene extensión .exe, así
  // que restringir el filtro no cuesta nada y evita que el usuario pique un
  // .dll o un acceso directo por error.
  ipcMain.handle('dialog:pickExecutable', (event) =>
    showPicker(event, {
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }),
  );

  // Campo "Install directory" (Add/Edit game) — al elegir la carpeta se
  // calcula su tamaño en el sitio, para no tener que recorrerla de nuevo
  // cada vez que se abre el detalle del juego.
  ipcMain.handle('dialog:pickDirectory', async (event) => {
    const path = await showPicker(event, { properties: ['openDirectory'] });
    if (path === null) return null;

    const sizeBytes = await getDirectorySize(path);
    return { path, sizeBytes };
  });

  // Botón "Back up now" de Ajustes — a diferencia de pickDirectory, no hace
  // falta el tamaño de la carpeta elegida, así que no vale la pena pagar el
  // recorrido de getDirectorySize por algo que se va a ignorar.
  ipcMain.handle('dialog:pickFolder', (event) =>
    showPicker(event, { properties: ['openDirectory'] }),
  );
};
