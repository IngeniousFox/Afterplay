import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  GeneratedMemorySummary,
  MemoriesStatus,
  MemoryActivityEvent,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Recaps del Loop: se generan en el main (cola de memories/queue.ts, espejo
// de las curiosidades) y aquí solo se leen. staleTime Infinity porque solo
// cambian cuando el main avisa por 'memories:activity' — y ese aviso ya
// invalida (useMemoriesActivity), no hace falta refetchear por mount/focus.
export const useMemories = (): UseQueryResult<GeneratedMemorySummary[], Error> =>
  useQuery({
    queryKey: queryKeys.memories.all,
    queryFn: () => window.api.memories.getAll(),
    staleTime: Infinity,
  });

export const useMemoriesStatus = (): UseQueryResult<MemoriesStatus, Error> =>
  useQuery({
    queryKey: queryKeys.memories.status,
    queryFn: () => window.api.memories.getStatus(),
    staleTime: Infinity,
  });

export const useRunMemoriesBackfill = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.memories.runBackfill() });

export const useRegenerateStaleMemories = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.memories.regenerateStale() });

export const useStopMemories = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.memories.stop() });

type MemoriesProgress = Extract<MemoryActivityEvent, { kind: 'progress' }>;

// Progreso en vivo + refresco automático de las queries — doble papel a
// propósito, mismo patrón que useCuriositiesActivity. El aviso 'generated'
// con origen automático es además la señal del toast de aterrizaje ("Your
// June story is ready"), pero ESO lo escucha su propio hook en la raíz
// (useMemoryArrivalToast): este solo alimenta la tarjeta de Ajustes.
export const useMemoriesActivity = (): MemoriesProgress | null => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<MemoriesProgress | null>(null);

  useEffect(() => {
    return window.api.memories.onActivity((event) => {
      // Invalidar el prefijo entero cubre también el status (queryKeys).
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
      if (event.kind === 'progress') setProgress(event);
    });
  }, [queryClient]);

  return progress;
};
