import { handleDb } from './dbHandle';
import type { AddStateEventInput, UpdateStateEventPatch } from '../../shared/types';
import { addStateEvent } from '../db/queries/stateEvents/addStateEvent';
import { getAllStateEvents } from '../db/queries/stateEvents/getAllStateEvents';
import { getStateEventsByIteration } from '../db/queries/stateEvents/getStateEventsByIteration';
import { updateStateEvent } from '../db/queries/stateEvents/updateStateEvent';

export const registerStateEventsHandlers = (): void => {
  handleDb('stateEvents:add', async (_event, input: AddStateEventInput) => {
    return addStateEvent(input);
  });

  handleDb('stateEvents:getAll', async () => {
    return getAllStateEvents();
  });

  handleDb('stateEvents:getByIteration', async (_event, iterationId: number) => {
    return getStateEventsByIteration(iterationId);
  });

  handleDb('stateEvents:update', async (_event, id: number, patch: UpdateStateEventPatch) => {
    return updateStateEvent(id, patch);
  });
};
