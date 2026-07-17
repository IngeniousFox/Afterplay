import { handleDb } from './dbHandle';
import type { CreateIterationInput, UpdateIterationPatch } from '../../shared/types';
import { createIteration } from '../db/queries/iterations/createIteration';
import { deleteIteration } from '../db/queries/iterations/deleteIteration';
import { updateIteration } from '../db/queries/iterations/updateIteration';

export const registerIterationsHandlers = (): void => {
  handleDb('iterations:create', async (_event, input: CreateIterationInput) => {
    return createIteration(input);
  });

  handleDb('iterations:update', async (_event, id: number, patch: UpdateIterationPatch) => {
    return updateIteration(id, patch);
  });

  handleDb('iterations:delete', async (_event, id: number) => {
    return deleteIteration(id);
  });
};
