import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  CuriositiesStatus,
  CuriosityActivityEvent,
  CuriositySummary,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Curiosidades de juego: se generan UNA vez por juego en el main (ver
// main/curiosities) y aquí solo se leen. staleTime Infinity porque solo
// cambian cuando el main avisa por 'curiosities:activity' — y ese aviso ya
// invalida (useCuriositiesActivity), no hace falta refetchear por mount/focus.
export const useCuriosities = (): UseQueryResult<CuriositySummary[], Error> =>
  useQuery({
    queryKey: queryKeys.curiosities.all,
    queryFn: () => window.api.curiosities.getAll(),
    staleTime: Infinity,
  });

export const useCuriositiesStatus = (): UseQueryResult<CuriositiesStatus, Error> =>
  useQuery({
    queryKey: queryKeys.curiosities.status,
    queryFn: () => window.api.curiosities.getStatus(),
    staleTime: Infinity,
  });

export const useRunCuriositiesBackfill = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.curiosities.runBackfill() });

type CuriositiesProgress = Extract<CuriosityActivityEvent, { kind: 'progress' }>;

// Progreso en vivo de la generación + refresco automático de las queries.
// Doble papel a propósito (mismo patrón que useSaveBackupActivity): quien lo
// monta ve avanzar la pasada, y de paso cada juego generado invalida las
// curiosidades — el modo ambiente y la tarjeta de Ajustes se actualizan solos.
export const useCuriositiesActivity = (): CuriositiesProgress | null => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<CuriositiesProgress | null>(null);

  useEffect(() => {
    return window.api.curiosities.onActivity((event) => {
      // Invalidar el prefijo entero cubre también el status (queryKeys).
      queryClient.invalidateQueries({ queryKey: queryKeys.curiosities.all });
      if (event.kind === 'progress') setProgress(event);
    });
  }, [queryClient]);

  return progress;
};
