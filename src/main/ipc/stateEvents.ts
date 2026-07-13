import { ipcMain } from 'electron';
import type { AddStateEventInput } from '../../shared/types';
import { addStateEvent } from '../db/queries/stateEvents/addStateEvent';
import { getStateEventsByIteration } from '../db/queries/stateEvents/getStateEventsByIteration';

export function registerStateEventsHandlers(): void {
  ipcMain.handle('stateEvents:add', async (_event, input: AddStateEventInput) => {
    return addStateEvent(input);
  });

  ipcMain.handle('stateEvents:getByIteration', async (_event, iterationId: number) => {
    return getStateEventsByIteration(iterationId);
  });
}
