import { handle } from './contractHandlers';
import type { CreateIterationInput, UpdateIterationPatch } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import {
  createIteration,
  deleteIteration,
  findConcurrentActivePlaythroughs,
  isPlaythroughMergeError,
  mergePlaythroughs,
  updateIteration,
} from '../db/v2/queries/playthroughs';
import { isStoreError } from '../db/v2/store/errors';
import type { GameId, IterationId } from '../../shared/entityIds';
import type {
  ConcurrentPlaythrough,
  MergePlaythroughsOutcome,
  MergePlaythroughsRequest,
} from '../../shared/playthroughMerge';

// Lo que se enseña cuando la fusión no se puede hacer. Mensajes de la interfaz
// (en inglés, como el resto de la app): salen tal cual en un toast.
const MERGE_MESSAGES = {
  not_found: 'One of those playthroughs no longer exists. It may have been deleted on another PC.',
  same_playthrough: 'Pick two different playthroughs to merge.',
  different_game: 'Those playthroughs belong to different games and can’t be merged.',
} as const;

/**
 * Fusiona y traduce los errores ESPERADOS (§10.7) a un resultado, para que la
 * ficha enseñe un mensaje y no un "Error invoking remote method". Cualquier
 * otro error se propaga: no se esconde un fallo de verdad.
 */
export const mergeOutcome = (request: MergePlaythroughsRequest): MergePlaythroughsOutcome => {
  try {
    const { moved } = mergePlaythroughs(appCtx(), request);
    return { ok: true, moved };
  } catch (error) {
    if (isPlaythroughMergeError(error)) {
      return { ok: false, reason: error.code, message: MERGE_MESSAGES[error.code] };
    }
    if (isStoreError(error, 'not_found') || isStoreError(error, 'deleted')) {
      return { ok: false, reason: 'not_found', message: MERGE_MESSAGES.not_found };
    }
    throw error;
  }
};

export const registerIterationsHandlers = (): void => {
  handle('iterations:create', async (_event, input: CreateIterationInput) => {
    return createIteration(appCtx(), input);
  });

  handle('iterations:update', async (_event, id: IterationId, patch: UpdateIterationPatch) => {
    return updateIteration(appCtx(), id, patch);
  });

  handle('iterations:delete', async (_event, id: IterationId) => {
    return deleteIteration(appCtx(), id);
  });

  // Los playthroughs activos de un juego cuando hay MÁS DE UNO (§10.7); lista
  // vacía si no. Es lo que dice "Two playthroughs are in progress" en la ficha.
  handle(
    'iterations:concurrent',
    async (_event, gameId: GameId): Promise<ConcurrentPlaythrough[]> =>
      findConcurrentActivePlaythroughs(appCtx(), gameId).map(({ id, label, current }) => ({
        id,
        label,
        current,
      })),
  );

  handle(
    'iterations:merge',
    async (_event, request: MergePlaythroughsRequest): Promise<MergePlaythroughsOutcome> =>
      mergeOutcome({ keepId: request.keepId, dropId: request.dropId }),
  );
};
