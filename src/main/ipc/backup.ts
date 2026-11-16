import { createManualBackup } from '../db/manualBackup';
import { handle } from './contractHandlers';

export const registerBackupHandlers = (): void => {
  handle('backup:createManual', async (_event, directory: string) => {
    return createManualBackup(directory);
  });
};
