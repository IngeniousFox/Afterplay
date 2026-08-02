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

// ⚠️ TEMPORAL — modo de prueba del aviso flotante. Devuelve si quedó
// encendido. Quitar con su botón cuando el diseño esté cerrado.
export const useToggleAchievementDemo = (): UseMutationResult<boolean, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.achievements.toggleDemo() });

type AchievementsProgress = Extract<AchievementActivityEvent, { kind: 'progress' }>;

// EL refresco de las queries de logros, montado UNA vez en la raíz de la app
// (Afterplay.tsx) — igual que useCuriositiesActivity y por el mismo motivo
// escrito allí: la sincronización ocurre de fondo estés donde estés, y quien
// la escuchaba antes era solo la tarjeta de Ajustes. Con el modal cerrado,
// nadie invalidaba nada; y como las queries de logros son staleTime Infinity,
// una ficha visitada ANTES de que su catálogo llegara se quedaba con la
// respuesta vacía cacheada para siempre — ni navegando fuera y volviendo se
// arreglaba, solo reiniciando la app.
//
// Sin estado a propósito (a diferencia del hook de abajo): una pasada de 300
// juegos emite 300 eventos, y guardar progreso aquí re-renderizaría el árbol
// entero con cada uno.
export const useAchievementsActivitySync = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.achievements.onActivity(() => {
      // Invalidar el prefijo entero cubre el status y todas las fichas.
      queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all });
    });
  }, [queryClient]);
};

// El progreso en vivo, para quien lo quiera pintar (la tarjeta de Ajustes).
// Solo estado: la invalidación la lleva el hook de arriba desde la raíz, y
// duplicarla aquí sería invalidar dos veces cada evento.
export const useAchievementsActivity = (): AchievementsProgress | null => {
  const [progress, setProgress] = useState<AchievementsProgress | null>(null);

  useEffect(() => {
    return window.api.achievements.onActivity((event) => {
      if (event.kind === 'progress') setProgress(event);
    });
  }, []);

  return progress;
};
