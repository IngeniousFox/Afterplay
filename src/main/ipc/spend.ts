import { ipcMain } from 'electron';
import type { AddSpendEventInput } from '../../shared/types';
import { addSpendEvent } from '../db/queries/spend/addSpendEvent';
import { deleteSpendEvent } from '../db/queries/spend/deleteSpendEvent';
import { getSpendByGame } from '../db/queries/spend/getSpendByGame';
import { updateSpendEvent } from '../db/queries/spend/updateSpendEvent';

export const registerSpendHandlers = (): void => {
  ipcMain.handle('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(input);
  });

  ipcMain.handle('spend:getByGame', async (_event, gameId: number) => {
    return getSpendByGame(gameId);
  });

  ipcMain.handle('spend:delete', async (_event, id: number) => {
    return deleteSpendEvent(id);
  });

  ipcMain.handle('spend:update', async (_event, id: number, note: string | null) => {
    return updateSpendEvent(id, note);
  });
};
