import { ipcMain } from 'electron';
import type { AddManualSessionInput } from '../../shared/types';
import { addManualSession } from '../db/queries/sessions/addManualSession';
import { getSessionsByIteration } from '../db/queries/sessions/getSessionsByIteration';

export function registerSessionsHandlers(): void {
  ipcMain.handle('sessions:add', async (_event, input: AddManualSessionInput) => {
    return addManualSession(input);
  });

  ipcMain.handle('sessions:getByIteration', async (_event, iterationId: number) => {
    return getSessionsByIteration(iterationId);
  });
}
