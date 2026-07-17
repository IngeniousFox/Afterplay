import { ipcMain } from 'electron';
import { createManualBackup } from '../db/manualBackup';

export const registerBackupHandlers = (): void => {
  ipcMain.handle('backup:createManual', async (_event, directory: string) => {
    return createManualBackup(directory);
  });
};
