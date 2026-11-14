import { handleDb } from './dbHandle';
import type { AddSpendEventInput, UpdateSpendEventPatch } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import {
  addSpendEvent,
  deleteSpendEvent,
  getAllSpendEvents,
  updateSpendEvent,
} from '../db/v2/queries/playthroughs';
import type { SpendEventId } from '../../shared/entityIds';

export const registerSpendHandlers = (): void => {
  handleDb('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(appCtx(), input);
  });

  handleDb('spend:getAll', async () => {
    return getAllSpendEvents(appCtx());
  });

  handleDb('spend:delete', async (_event, id: SpendEventId) => {
    return deleteSpendEvent(appCtx(), id);
  });

  handleDb('spend:update', async (_event, id: SpendEventId, patch: UpdateSpendEventPatch) => {
    return updateSpendEvent(appCtx(), id, patch);
  });
};
