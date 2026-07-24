import type { UseMutationResult } from '@tanstack/react-query';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// No hay useIterations(gameId) — games:getById ya trae las iteraciones
// enriquecidas (horas, fechas derivadas, estado) dentro de GameDetail, así
// que un listado aparte de filas crudas no tiene consumidor.
export const useCreateIteration = (): UseMutationResult<
  Iteration,
  Error,
  CreateIterationInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: CreateIterationInput) => window.api.iterations.create(input),
    [queryKeys.games.all],
  );

export const useUpdateIteration = (): UseMutationResult<
  Iteration | null,
  Error,
  { id: number; patch: UpdateIterationPatch },
  unknown
> =>
  useInvalidatingMutation(
    ({ id, patch }: { id: number; patch: UpdateIterationPatch }) =>
      window.api.iterations.update(id, patch),
    [queryKeys.games.all],
  );

// Borrar una iteración arrastra en cascada (ON DELETE CASCADE, ver
// deleteIteration.ts) sus sessions y state_events — igual que useDeleteGame,
// esas dos listas se quedaban mostrando datos huérfanos hasta reiniciar la
// app cuando esto solo invalidaba games.all (bug real, encontrado en
// auditoría). Compárese con useResetEndlessState (games.ts), una operación
// más ligera que ya invalidaba las tres correctamente.
export const useDeleteIteration = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.iterations.delete(id),
    [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stateEvents.all],
  );
