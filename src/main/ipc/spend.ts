import { ipcMain } from 'electron';
import type { AddSpendEventInput } from '../../shared/types';
import { addSpendEvent } from '../db/queries/spend/addSpendEvent';
import { getSpendByGame } from '../db/queries/spend/getSpendByGame';

export const registerSpendHandlers = (): void => {
  ipcMain.handle('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(input);
  });

  ipcMain.handle('spend:getByGame', async (_event, gameId: number) => {
    return getSpendByGame(gameId);
  });
};
