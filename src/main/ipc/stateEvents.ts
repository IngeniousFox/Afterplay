import { ipcMain } from 'electron';
import type { AddStateEventInput } from '../../shared/types';
import { addStateEvent } from '../db/queries/stateEvents/addStateEvent';
import { getStateEventsByIteration } from '../db/queries/stateEvents/getStateEventsByIteration';
import { updateStateEvent } from '../db/queries/stateEvents/updateStateEvent';

export const registerStateEventsHandlers = (): void => {
  ipcMain.handle('stateEvents:add', async (_event, input: AddStateEventInput) => {
    return addStateEvent(input);
  });

  ipcMain.handle('stateEvents:getByIteration', async (_event, iterationId: number) => {
    return getStateEventsByIteration(iterationId);
  });

  ipcMain.handle('stateEvents:update', async (_event, id: number, note: string | null) => {
    return updateStateEvent(id, note);
  });
};
