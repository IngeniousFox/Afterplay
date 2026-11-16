import { handle } from './contractHandlers';
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
  handle('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(appCtx(), input);
  });

  handle('spend:getAll', async () => {
    return getAllSpendEvents(appCtx());
  });

  handle('spend:delete', async (_event, id: SpendEventId) => {
    return deleteSpendEvent(appCtx(), id);
  });

  handle('spend:update', async (_event, id: SpendEventId, patch: UpdateSpendEventPatch) => {
    return updateSpendEvent(appCtx(), id, patch);
  });
};
