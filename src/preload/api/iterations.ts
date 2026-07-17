import { ipcRenderer } from 'electron';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../shared/types';

export const iterationsApi = {
  create: (input: CreateIterationInput): Promise<Iteration> =>
    ipcRenderer.invoke('iterations:create', input),
  update: (id: number, patch: UpdateIterationPatch): Promise<Iteration | null> =>
    ipcRenderer.invoke('iterations:update', id, patch),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('iterations:delete', id),
};
