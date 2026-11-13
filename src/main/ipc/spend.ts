import { handleDb } from './dbHandle';
import type { AddSpendEventInput, UpdateSpendEventPatch } from '../../shared/types';
import { addSpendEvent } from '../db/queries/spend/addSpendEvent';
import { deleteSpendEvent } from '../db/queries/spend/deleteSpendEvent';
import { getAllSpendEvents } from '../db/queries/spend/getAllSpendEvents';
import { updateSpendEvent } from '../db/queries/spend/updateSpendEvent';
import type { SpendEventId } from '../../shared/entityIds';

export const registerSpendHandlers = (): void => {
  handleDb('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(input);
  });

  handleDb('spend:getAll', async () => {
    return getAllSpendEvents();
  });

  handleDb('spend:delete', async (_event, id: SpendEventId) => {
    return deleteSpendEvent(id);
  });

  handleDb('spend:update', async (_event, id: SpendEventId, patch: UpdateSpendEventPatch) => {
    return updateSpendEvent(id, patch);
  });
};
