import type { UseMutationResult } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddStateEventInput, StateEvent } from '../../../shared/types';
import { queryKeys } from './queryKeys';

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
    },
  });
};

export const useUpdateStateEvent = (): UseMutationResult<
  StateEvent | null,
  Error,
  { id: number; note: string | null },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string | null }) =>
      window.api.stateEvents.update(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};
