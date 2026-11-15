import { ipcRenderer } from 'electron';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../shared/types';
import type { GameId, IterationId } from '../../shared/entityIds';
import type {
  ConcurrentPlaythrough,
  MergePlaythroughsOutcome,
  MergePlaythroughsRequest,
} from '../../shared/playthroughMerge';

export const iterationsApi = {
  create: (input: CreateIterationInput): Promise<Iteration> =>
    ipcRenderer.invoke('iterations:create', input),
  update: (id: IterationId, patch: UpdateIterationPatch): Promise<Iteration | null> =>
    ipcRenderer.invoke('iterations:update', id, patch),
  delete: (id: IterationId): Promise<boolean> => ipcRenderer.invoke('iterations:delete', id),
  // §10.7: dos playthroughs en curso del mismo juego y su reparación.
  concurrent: (gameId: GameId): Promise<ConcurrentPlaythrough[]> =>
    ipcRenderer.invoke('iterations:concurrent', gameId),
  merge: (request: MergePlaythroughsRequest): Promise<MergePlaythroughsOutcome> =>
    ipcRenderer.invoke('iterations:merge', request),
};
