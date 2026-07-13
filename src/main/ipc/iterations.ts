import { ipcMain } from 'electron';
import type { CreateIterationInput } from '../../shared/types';
import { createIteration } from '../db/queries/iterations/createIteration';
import { getIterationsByGame } from '../db/queries/iterations/getIterationsByGame';

export const registerIterationsHandlers = (): void => {
  ipcMain.handle('iterations:create', async (_event, input: CreateIterationInput) => {
    return createIteration(input);
  });

  ipcMain.handle('iterations:getByGame', async (_event, gameId: number) => {
    return getIterationsByGame(gameId);
  });
};
