import { handleDb } from './dbHandle';
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
  handleDb('stateEvents:add', async (_event, input: AddStateEventInput) => {
    return addStateEvent(appCtx(), input);
  });

  handleDb('stateEvents:getAll', async () => {
    return getAllStateEvents(appCtx());
  });

  handleDb('stateEvents:update', async (_event, id: StateEventId, patch: UpdateStateEventPatch) => {
    return updateStateEvent(appCtx(), id, patch);
  });

  handleDb('stateEvents:delete', async (_event, id: StateEventId) => {
    return deleteStateEvent(appCtx(), id);
  });
};
