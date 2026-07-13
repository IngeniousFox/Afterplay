import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddSpendEventInput, SpendEvent } from '../../../shared/types';
import { queryKeys } from './queryKeys';

export const useGameSpend = (gameId: number): UseQueryResult<SpendEvent[], Error> =>
  useQuery({
    queryKey: queryKeys.games.spend(gameId),
    queryFn: () => window.api.spend.getByGame(gameId),
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
    },
  });
};
