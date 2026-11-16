import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  ConcurrentPlaythrough,
  MergePlaythroughsOutcome,
  MergePlaythroughsRequest,
} from '../../../shared/playthroughMerge';
import type { CreateIterationInput, Iteration, UpdateIterationPatch } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import type { GameId, IterationId } from '../../../shared/entityIds';

// No hay useIterations(gameId) — games:getById ya trae las iteraciones
// enriquecidas (horas, fechas derivadas, estado) dentro de GameDetail, así
// que un listado aparte de filas crudas no tiene consumidor.
export const useCreateIteration = (): UseMutationResult<
  Iteration,
  Error,
  CreateIterationInput,
  unknown
> =>
  useMutation({ mutationFn: (input: CreateIterationInput) => window.api.iterations.create(input) });

export const useUpdateIteration = (): UseMutationResult<
  Iteration | null,
  Error,
  { id: IterationId; patch: UpdateIterationPatch },
  unknown
> =>
  useMutation({
    mutationFn: ({ id, patch }: { id: IterationId; patch: UpdateIterationPatch }) =>
      window.api.iterations.update(id, patch),
  });

// Borrar una iteración arrastra en cascada (ON DELETE CASCADE, ver
// deleteIteration.ts) sus sessions y state_events — igual que useDeleteGame,
// esas dos listas se quedaban mostrando datos huérfanos hasta reiniciar la
// app cuando esto solo invalidaba games.all (bug real, encontrado en
// auditoría). Compárese con useResetEndlessState (games.ts), una operación
// más ligera que ya invalidaba las tres correctamente.
export const useDeleteIteration = (): UseMutationResult<boolean, Error, IterationId, unknown> =>
  useMutation({ mutationFn: (id: IterationId) => window.api.iterations.delete(id) });

// §10.7 — los playthroughs activos del juego cuando hay MÁS DE UNO (dos PCs
// sin red crearon cada uno el suyo). Lista vacía = nada que reparar. Su key
// cuelga de ['games'], así que se relee con cada aviso de cambios.
export const useConcurrentPlaythroughs = (
  gameId: GameId | null,
): UseQueryResult<ConcurrentPlaythrough[], Error> =>
  useQuery({
    queryKey: queryKeys.playthroughs.concurrent(gameId),
    queryFn: () => window.api.iterations.concurrent(gameId as GameId),
    enabled: gameId !== null,
    staleTime: Infinity,
  });

// Fusionar mueve sesiones, eventos de estado, gastos y logros de un playthrough
// al otro y borra el sobrante: cambia casi todo lo derivado del juego (horas,
// estado, gasto) y las listas de sesiones y eventos. Invalida lo mismo que
// borrar un playthrough, más los logros (sus desbloqueos cambian de playthrough)
// y el gasto.
export const useMergePlaythroughs = (): UseMutationResult<
  MergePlaythroughsOutcome,
  Error,
  MergePlaythroughsRequest,
  unknown
> =>
  useMutation({
    mutationFn: (request: MergePlaythroughsRequest) => window.api.iterations.merge(request),
  });
