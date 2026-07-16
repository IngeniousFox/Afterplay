import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

export const useGameSpend = (gameId: number): UseQueryResult<SpendEvent[], Error> =>
  useQuery({
    queryKey: queryKeys.games.spend(gameId),
    queryFn: () => window.api.spend.getByGame(gameId),
  });

// Bloque 5B — todos los gastos de la biblioteca (para Total Spent / Avg
// Cost per Hour, con o sin filtro de año). Misma historia que useGames()/
// useAllSessions(): staleTime Infinity, invalidada por las mutations de aquí.
export const useAllSpendEvents = (): UseQueryResult<SpendEventSummary[], Error> =>
  useQuery({
    queryKey: queryKeys.spend.all,
    queryFn: () => window.api.spend.getAll(),
    staleTime: Infinity,
  });

export const useAddSpend = (): UseMutationResult<
  SpendEvent,
  Error,
  AddSpendEventInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSpendEventInput) => window.api.spend.add(input),
    onSuccess: () => {
      // ['games'] cascada tanto al detalle del juego (cambia totalSpend/
      // costPerHour) como a ['games', gameId, 'spend'] — misma jerarquía.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.spend.all });
    },
  });
};

export const useDeleteSpendEvent = (): UseMutationResult<boolean, Error, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => window.api.spend.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.spend.all });
    },
  });
};

export const useUpdateSpendEvent = (): UseMutationResult<
  SpendEvent | null,
  Error,
  { id: number; patch: UpdateSpendEventPatch },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateSpendEventPatch }) =>
      window.api.spend.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.spend.all });
    },
  });
};
