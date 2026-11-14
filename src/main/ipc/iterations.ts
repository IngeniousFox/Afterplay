import { handleDb } from './dbHandle';
import type { CreateIterationInput, UpdateIterationPatch } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import { createIteration, deleteIteration, updateIteration } from '../db/v2/queries/playthroughs';
import type { IterationId } from '../../shared/entityIds';

export const registerIterationsHandlers = (): void => {
  handleDb('iterations:create', async (_event, input: CreateIterationInput) => {
    return createIteration(appCtx(), input);
  });

  handleDb('iterations:update', async (_event, id: IterationId, patch: UpdateIterationPatch) => {
    return updateIteration(appCtx(), id, patch);
  });

  handleDb('iterations:delete', async (_event, id: IterationId) => {
    return deleteIteration(appCtx(), id);
  });
};
