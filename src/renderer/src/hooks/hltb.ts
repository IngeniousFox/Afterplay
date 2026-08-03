import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HltbTimes } from '../../../shared/types';
import { queryKeys } from './queryKeys';

export const useHltbTimes = (
  title: string,
  releaseYear: number | null,
): UseQueryResult<HltbTimes | null, Error> => {
  const trimmed = title.trim();

  return useQuery({
    queryKey: queryKeys.hltb.times(trimmed, releaseYear),
    queryFn: () => window.api.hltb.getTimes(trimmed, releaseYear),
    enabled: trimmed.length > 0,
    staleTime: Infinity, // los tiempos de HLTB no cambian durante la sesión de uso
  });
};

// Vuelve a pedir los tiempos de UN juego ya dado de alta y los guarda.
//
// Invalida ['games'] porque los tiempos viven en la fila del juego, no en
// una query propia de HLTB: la card del detalle los lee de `game.hltbMain`,
// y la Deuda del Backlog los suma desde la lista. Con el prefijo entero se
// refrescan los dos sin tener que saber qué pantalla está abierta.
export const useRefreshGameHltb = (): UseMutationResult<
  HltbTimes | null,
  Error,
  number,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => window.api.hltb.refreshGame(gameId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.games.all }),
  });
};
