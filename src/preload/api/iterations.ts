import { ipcRenderer } from 'electron';
import type { CreateIterationInput, Iteration } from '../../shared/types';

export const iterationsApi = {
  create: (input: CreateIterationInput): Promise<Iteration> =>
    ipcRenderer.invoke('iterations:create', input),
  getByGame: (gameId: number): Promise<Iteration[]> =>
    ipcRenderer.invoke('iterations:getByGame', gameId),
};
