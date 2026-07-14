import { ipcMain } from 'electron';
import type { CreateIterationInput, UpdateIterationPatch } from '../../shared/types';
import { createIteration } from '../db/queries/iterations/createIteration';
import { deleteIteration } from '../db/queries/iterations/deleteIteration';
import { getIterationsByGame } from '../db/queries/iterations/getIterationsByGame';
import { updateIteration } from '../db/queries/iterations/updateIteration';

export const registerIterationsHandlers = (): void => {
  ipcMain.handle('iterations:create', async (_event, input: CreateIterationInput) => {
    return createIteration(input);
  });

  ipcMain.handle('iterations:getByGame', async (_event, gameId: number) => {
    return getIterationsByGame(gameId);
  });

  ipcMain.handle('iterations:update', async (_event, id: number, patch: UpdateIterationPatch) => {
    return updateIteration(id, patch);
  });

  ipcMain.handle('iterations:delete', async (_event, id: number) => {
    return deleteIteration(id);
  });
};
