import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  AchievementActivityEvent,
  AchievementsOverview,
  AchievementsStatus,
  GameAchievements,
  SessionUnlock,
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

// La vista global del bloque de trofeos de Stats, acotable al filtro de año
// de la pantalla ('all' = toda la vida). Mismo contrato de frescura que el
// resto de queries de logros: staleTime Infinity + invalidación por el
// prefijo entero desde la raíz (useAchievementsActivitySync).
export const useAchievementsOverview = (
  year: number | 'all' = 'all',
): UseQueryResult<AchievementsOverview, Error> =>
  useQuery({
    queryKey: queryKeys.achievements.overview(year),
    queryFn: () => window.api.achievements.getOverview(year === 'all' ? null : year),
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

// Los desbloqueos colgados de sesiones, para las filas de la pantalla de
// Sesiones. Mismo contrato de frescura que el resto: staleTime Infinity +
// invalidación por el prefijo entero desde la raíz.
export const useSessionUnlocks = (): UseQueryResult<SessionUnlock[], Error> =>
  useQuery({
    queryKey: queryKeys.achievements.sessionUnlocks,
    queryFn: () => window.api.achievements.getSessionUnlocks(),
    staleTime: Infinity,
  });

// Cuánto se espera como mucho a que la cola llegue a NUESTRO juego antes de
// dejar de girar. La cola es serial y puede tener 300 juegos por delante: sin
// este tope, pulsar refrescar en mitad de una pasada dejaría la ruedecita
// dando vueltas varios minutos. El refresco se completa igual — solo se deja
// de fingir que se está esperando por él.
const REFRESH_SPIN_TIMEOUT_MS = 45_000;

// Refrescar los logros de UN juego desde su ficha.
//
// El "cuándo ha terminado" no puede salir de la mutación: encolar devuelve al
// instante y el trabajo real lo hace la cola del main. Así que se escucha el
// evento 'synced' de ESE gameId, que es exactamente la señal de "este juego
// ya está". Si el juego ni siquiera entró en la cola (sin clave de Steam, o
// no está en Steam), se para en seco en vez de esperar a nadie.
export const useRefreshGameAchievements = (
  gameId: number,
): { refresh: () => void; refreshing: boolean } => {
  const [refreshing, setRefreshing] = useState(false);

  // Cambiar de juego con un refresco en vuelo (navegar de una ficha a otra)
  // dejaría la ruedecita girando sobre un juego que no es el suyo. Ajuste
  // DURANTE EL RENDER y no en un efecto (el patrón de react.dev, y la regla
  // de la casa): así el render nuevo ya sale correcto, sin un primer frame
  // mintiendo y un re-render detrás para corregirlo.
  const [trackedGameId, setTrackedGameId] = useState(gameId);
  if (trackedGameId !== gameId) {
    setTrackedGameId(gameId);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!refreshing) return;

    const stopListening = window.api.achievements.onActivity((event) => {
      if (event.kind === 'synced' && event.gameId === gameId) setRefreshing(false);
    });
    const guard = setTimeout(() => setRefreshing(false), REFRESH_SPIN_TIMEOUT_MS);

    return () => {
      stopListening();
      clearTimeout(guard);
    };
  }, [refreshing, gameId]);

  const refresh = (): void => {
    if (refreshing) return;
    setRefreshing(true);
    void window.api.achievements.refreshGame(gameId).then((queued) => {
      if (!queued) setRefreshing(false);
    });
  };

  return { refresh, refreshing };
};

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
