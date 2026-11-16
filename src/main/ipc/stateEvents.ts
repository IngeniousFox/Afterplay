import { handle } from './contractHandlers';
import type { AddStateEventInput, UpdateStateEventPatch } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import {
  addStateEvent,
  deleteStateEvent,
  getAllStateEvents,
  updateStateEvent,
} from '../db/v2/queries/playthroughs';
import type { StateEventId } from '../../shared/entityIds';

export const registerStateEventsHandlers = (): void => {
  handle('stateEvents:add', async (_event, input: AddStateEventInput) => {
    return addStateEvent(appCtx(), input);
  });

  handle('stateEvents:getAll', async () => {
    return getAllStateEvents(appCtx());
  });

  handle('stateEvents:update', async (_event, id: StateEventId, patch: UpdateStateEventPatch) => {
    return updateStateEvent(appCtx(), id, patch);
  });

  handle('stateEvents:delete', async (_event, id: StateEventId) => {
    return deleteStateEvent(appCtx(), id);
  });
};
