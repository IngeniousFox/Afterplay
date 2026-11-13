import { ipcRenderer } from 'electron';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../shared/types';
import type { IterationId } from '../../shared/entityIds';

export const iterationsApi = {
  create: (input: CreateIterationInput): Promise<Iteration> =>
    ipcRenderer.invoke('iterations:create', input),
  update: (id: IterationId, patch: UpdateIterationPatch): Promise<Iteration | null> =>
    ipcRenderer.invoke('iterations:update', id, patch),
  delete: (id: IterationId): Promise<boolean> => ipcRenderer.invoke('iterations:delete', id),
};
