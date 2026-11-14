import { ipcMain } from 'electron';

// Los handlers que tocan la base. En la 1.x esperaban a la conexión con Turso
// y pasaban por el candado de `withDbAccess`; la base 2.0 se abre síncrona
// ANTES de registrar el IPC (index.ts, initAppDb), así que ya no hay nada que
// esperar. Se conserva el nombre para marcar qué canales leen o escriben datos.

type IpcHandler = Parameters<typeof ipcMain.handle>[1];

export const handleDb = (channel: string, handler: IpcHandler): void => {
  ipcMain.handle(channel, handler);
};
