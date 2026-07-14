import type { UseMutationResult } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../../shared/types';
import { queryKeys } from './queryKeys';

// No hay useIterations(gameId) — games:getById ya trae las iteraciones
// enriquecidas (horas, fechas derivadas, estado) dentro de GameDetail, así
// que un listado aparte de filas crudas no tiene consumidor.
export const useAddIteration = (): UseMutationResult<
  Iteration,
  Error,
  CreateIterationInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIterationInput) => window.api.iterations.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

export const useUpdateIteration = (): UseMutationResult<
  Iteration | null,
  Error,
  { id: number; patch: UpdateIterationPatch },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateIterationPatch }) =>
      window.api.iterations.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

export const useDeleteIteration = (): UseMutationResult<boolean, Error, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => window.api.iterations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};
