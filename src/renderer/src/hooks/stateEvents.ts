import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  AddStateEventInput,
  StateEvent,
  StateEventSummary,
  UpdateStateEventPatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';
import type { StateEventId } from '../../../shared/entityIds';

// Bloque 5D — todos los cambios de estado de la biblioteca (para "Status
// Changes" por año en Stats). Misma historia que useSessions()/
// useSpendEvents(): staleTime Infinity, invalidada por las mutations de
// aquí.
export const stateEventsQueryOptions = {
  queryKey: queryKeys.stateEvents.all,
  queryFn: () => window.api.stateEvents.getAll(),
  staleTime: Infinity,
};

export const useStateEvents = (): UseQueryResult<StateEventSummary[], Error> =>
  useQuery(stateEventsQueryOptions);

// Un evento de estado nuevo cambia currentState/stateHistory del juego dueño
// de la iteración — no sabemos su gameId aquí (el input solo trae
// iterationId), así que invalidamos ['games'] entero.
export const useAddStateEvent = (): UseMutationResult<
  StateEvent,
  Error,
  AddStateEventInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: AddStateEventInput) => window.api.stateEvents.add(input),
    [queryKeys.games.all, queryKeys.stateEvents.all],
  );

// La fecha de un evento puede cambiar el orden del historial y hasta el
// estado actual derivado (el evento más reciente) — y Stats por año cuenta
// transiciones por fecha (stateEvents.all).
export const useUpdateStateEvent = (): UseMutationResult<
  StateEvent | null,
  Error,
  { id: StateEventId; patch: UpdateStateEventPatch },
  unknown
> =>
  useInvalidatingMutation(
    ({ id, patch }: { id: StateEventId; patch: UpdateStateEventPatch }) =>
      window.api.stateEvents.update(id, patch),
    [queryKeys.games.all, queryKeys.stateEvents.all],
  );

// Borrar un evento: la corrección de playthrough del Edit modal
// (Beaten/Dropped → Playing, ver saveExistingIteration) y la papelera del
// History de la ficha. El estado derivado del juego cambia igual que con
// update, mismas invalidaciones.
export const useDeleteStateEvent = (): UseMutationResult<boolean, Error, StateEventId, unknown> =>
  useInvalidatingMutation(
    (id: StateEventId) => window.api.stateEvents.delete(id),
    [queryKeys.games.all, queryKeys.stateEvents.all],
  );
