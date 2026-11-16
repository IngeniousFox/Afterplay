import { invoke } from '../ipc';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../shared/types';
import type { GameId, IterationId } from '../../shared/entityIds';
import type {
  ConcurrentPlaythrough,
  MergePlaythroughsOutcome,
  MergePlaythroughsRequest,
} from '../../shared/playthroughMerge';

export const iterationsApi = {
  create: (input: CreateIterationInput): Promise<Iteration> => invoke('iterations:create', input),
  update: (id: IterationId, patch: UpdateIterationPatch): Promise<Iteration | null> =>
    invoke('iterations:update', id, patch),
  delete: (id: IterationId): Promise<boolean> => invoke('iterations:delete', id),
  // §10.7: dos playthroughs en curso del mismo juego y su reparación.
  concurrent: (gameId: GameId): Promise<ConcurrentPlaythrough[]> =>
    invoke('iterations:concurrent', gameId),
  merge: (request: MergePlaythroughsRequest): Promise<MergePlaythroughsOutcome> =>
    invoke('iterations:merge', request),
};
