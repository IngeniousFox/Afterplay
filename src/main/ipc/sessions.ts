import { ipcMain } from 'electron';
import type { AddManualSessionInput } from '../../shared/types';
import { addManualSession } from '../db/queries/sessions/addManualSession';
import { closeSession } from '../db/queries/sessions/closeSession';
import { getSessionsByIteration } from '../db/queries/sessions/getSessionsByIteration';

export const registerSessionsHandlers = (): void => {
  ipcMain.handle('sessions:add', async (_event, input: AddManualSessionInput) => {
    return addManualSession(input);
  });

  ipcMain.handle('sessions:getByIteration', async (_event, iterationId: number) => {
    return getSessionsByIteration(iterationId);
  });

  ipcMain.handle('sessions:close', async (_event, id: number, endedAt: Date) => {
    return closeSession(id, endedAt);
  });
};
