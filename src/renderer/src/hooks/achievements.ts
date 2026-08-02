import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  AchievementActivityEvent,
  AchievementsStatus,
  GameAchievements,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Logros de un juego. staleTime Infinity porque solo cambian cuando el main
// avisa por 'achievements:activity' — y ese aviso ya invalida (ver
// useAchievementsActivity), así que no hace falta refetchear por mount/focus.
export const useGameAchievements = (gameId: number): UseQueryResult<GameAchievements, Error> =>
  useQuery({
    queryKey: queryKeys.achievements.game(gameId),
    queryFn: () => window.api.achievements.getForGame(gameId),
    staleTime: Infinity,
  });

export const useAchievementsStatus = (): UseQueryResult<AchievementsStatus, Error> =>
  useQuery({
    queryKey: queryKeys.achievements.status,
    queryFn: () => window.api.achievements.getStatus(),
    staleTime: Infinity,
  });

// Devuelve cuántos juegos entraron en la cola — el progreso llega por
// useAchievementsActivity, no por esta respuesta.
export const useSyncAchievements = (): UseMutationResult<number, Error, boolean, unknown> =>
  useMutation({ mutationFn: (full: boolean) => window.api.achievements.sync(full) });

export const useStopAchievements = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.achievements.stop() });

// Reintenta solo los juegos que fallaron en la última pasada.
export const useRetryFailedAchievements = (): UseMutationResult<number, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.achievements.retryFailed() });

type AchievementsProgress = Extract<AchievementActivityEvent, { kind: 'progress' }>;

// Progreso en vivo + refresco automático de las queries. Doble papel a
// propósito (mismo patrón que useCuriositiesActivity): quien lo monta ve
// avanzar la pasada, y de paso cada juego sincronizado invalida los logros —
// la ficha abierta y la tarjeta de Ajustes se actualizan solas.
export const useAchievementsActivity = (): AchievementsProgress | null => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<AchievementsProgress | null>(null);

  useEffect(() => {
    return window.api.achievements.onActivity((event) => {
      // Invalidar el prefijo entero cubre el status y todas las fichas.
      queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all });
      if (event.kind === 'progress') setProgress(event);
    });
  }, [queryClient]);

  return progress;
};
