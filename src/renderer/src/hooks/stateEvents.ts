import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddStateEventInput,
  StateEvent,
  StateEventSummary,
  UpdateStateEventPatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Bloque 5D — todos los cambios de estado de la biblioteca (para "Status
// Changes" por año en Stats). Misma historia que useAllSessions()/
// useAllSpendEvents(): staleTime Infinity, invalidada por las mutations de
// aquí.
export const useAllStateEvents = (): UseQueryResult<StateEventSummary[], Error> =>
  useQuery({
    queryKey: queryKeys.stateEvents.all,
    queryFn: () => window.api.stateEvents.getAll(),
    staleTime: Infinity,
  });

export const useAddStateEvent = (): UseMutationResult<
  StateEvent,
  Error,
  AddStateEventInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddStateEventInput) => window.api.stateEvents.add(input),
    onSuccess: () => {
      // Un evento de estado nuevo cambia currentState/stateHistory del
      // juego dueño de la iteración — no sabemos su gameId aquí (el input
      // solo trae iterationId), así que invalidamos ['games'] entero.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    },
  });
};

export const useUpdateStateEvent = (): UseMutationResult<
  StateEvent | null,
  Error,
  { id: number; patch: UpdateStateEventPatch },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateStateEventPatch }) =>
      window.api.stateEvents.update(id, patch),
    onSuccess: () => {
      // La fecha de un evento puede cambiar el orden del historial y hasta
      // el estado actual derivado (el evento más reciente) — y Stats por año
      // cuenta transiciones por fecha (stateEvents.all).
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    },
  });
};
