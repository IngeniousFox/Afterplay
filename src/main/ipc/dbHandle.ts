import { ipcMain } from 'electron';
import { withDbAccess } from '../db';

type IpcHandler = Parameters<typeof ipcMain.handle>[1];

// Igual que ipcMain.handle, para los dominios que tocan la DB: el handler
// corre dentro de withDbAccess(), así cuenta como query en vuelo y espera si
// hay un swap de conexión en curso (reconexión con Turso en caliente — ver
// attemptSyncUpgrade en db/index.ts). Los dominios sin DB (window, dialog,
// igdb...) siguen usando ipcMain.handle directamente.
export const handleDb = (channel: string, handler: IpcHandler): void => {
  ipcMain.handle(channel, (event, ...args) => withDbAccess(async () => handler(event, ...args)));
};
