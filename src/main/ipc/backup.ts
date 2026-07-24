import { createManualBackup } from '../db/manualBackup';
import { handleDb } from './dbHandle';

export const registerBackupHandlers = (): void => {
  handleDb('backup:createManual', async (_event, directory: string) => {
    return createManualBackup(directory);
  });
};
