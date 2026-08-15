import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
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
// avisa por 'achievements:activity' — y ese aviso ya invalida esta key (ver
// createAchievementsActivityInvalidator: la ficha del juego sincronizado es
// justo lo que SÍ se refresca al momento, incluso a media pasada), así que no
// hace falta refetchear por mount/focus.
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
// resto de queries de logros: staleTime Infinity + invalidación desde la raíz
// (useAchievementsActivitySync).
//
// Es la consulta MÁS CARA de la app —220 ms sobre la biblioteca real, 487 con
// cinco años— y por eso es la que decidió la regla de invalidación de abajo:
// a media pasada de sincronización se marca vieja pero NO se refetchea, y el
// fin de racha la pide una sola vez.
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
// invalidación desde la raíz (useAchievementsActivitySync).
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
    void window.api.achievements
      .refreshGame(gameId)
      .then((queued) => {
        if (!queued) setRefreshing(false);
      })
      // Si el invoke rechaza (el main lanza antes de encolar), sin este catch
      // setRefreshing(false) no corría por esa vía y la ruedecita giraba hasta
      // el guard de 45s. Se apaga ya.
      .catch(() => setRefreshing(false));
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
// Sin estado de React a propósito (a diferencia del hook de abajo): una pasada
// de 957 juegos emite casi 2.000 eventos, y guardar progreso aquí
// re-renderizaría el árbol entero con cada uno.
export const useAchievementsActivitySync = (): void => {
  const queryClient = useQueryClient();

  useEffect(
    () => window.api.achievements.onActivity(createAchievementsActivityInvalidator(queryClient)),
    [queryClient],
  );
};

// QUÉ SE REFRESCA CON CADA AVISO DE LA COLA DE LOGROS, y por qué no es
// "el prefijo entero, siempre", que es lo que hacía antes.
//
// LO QUE COSTABA, medido con el QueryClient de verdad sobre la biblioteca real
// (994 juegos, 39.808 logros): una pasada de "Sync now" recorre 957 juegos
// —todos los que tienen appid, planeados incluidos (getPendingAchievementsGames)—
// y la cola emite DOS avisos por juego: onProgress(running=true) antes de
// empezarlo y 'synced' al terminarlo (lib/claimQueue.ts). Son 1.915 avisos, y
// cada uno invalidaba ['achievements'] entero. Con Stats abierto eso son 1.915
// refetches de getAchievementsOverview a 220 ms cada uno = 422 SEGUNDOS de
// trabajo de base en el proceso main (y 487 ms x 1.915 = 15 min con cinco años
// de uso), para pintar 1.914 fotos que nadie llega a mirar: los eventos van a
// ~2 s de distancia, así que a cada refetch le daba tiempo a completarse antes
// de que el siguiente lo tirara a la basura.
//
// Y lo peor no es el número: la cola respira 120 ms entre juegos A PROPÓSITO
// (ver breatheMs en steam/queue.ts) para que el ciclo de sync con Turso pueda
// entrar a ese mismo fichero. Meter 220 ms de agregado por juego se come ese
// respiro y algo más — la invalidación estaba peleándose con el diseño de la
// cola.
//
// LA REGLA, ahora:
//   · 'progress' no trae ningún dato nuevo. Es la barra de la tarjeta de
//     Ajustes, que la pinta useAchievementsActivity con estado local (y la
//     propia tarjeta ya dice que el evento en vivo manda sobre la query).
//     El único que refresca es el ÚLTIMO, running=false: cierra la racha con
//     un refresco completo. Ese siempre llega — claimQueue lo emite en un
//     `finally`, así que también tras un stop, un fallo del worker o quedarse
//     sin clave.
//   · 'synced' DENTRO de una pasada refresca solo la ficha de ESE juego (0,7
//     ms, y solo si la tienes abierta). Los agregados globales —overview,
//     status, sessionUnlocks— se marcan viejos SIN refetch: quien los monte a
//     media pasada los pedirá al montar (staleTime Infinity respeta
//     isInvalidated), y el fin de racha los refresca una vez para todos.
//   · 'synced' SUELTO, sin pasada alrededor, sí refresca todo: es el sondeo en
//     vivo de Steam/RA (steam/livePoll.ts) cantando un logro que acabas de
//     sacar. No hay ninguna racha que vaya a cerrarse detrás de él, así que si
//     este no refresca, no refresca nadie.
//
// Exportado aparte del hook porque el estado de la racha vive en el cierre (no
// hace falta un useRef para algo que nadie repinta) y porque así la cuenta de
// consultas por aviso se puede medir sin montar React.
export const createAchievementsActivityInvalidator = (
  queryClient: QueryClient,
): ((event: AchievementActivityEvent) => void) => {
  let passRunning = false;

  return (event: AchievementActivityEvent): void => {
    if (event.kind === 'progress') {
      passRunning = event.running;
      if (!event.running) {
        queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all });
      }
      return;
    }

    if (!passRunning) {
      queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all });
      return;
    }

    // El orden NO es cosmético: marcar viejo el prefijo entero va PRIMERO
    // porque también alcanza a la ficha de este juego, y hacerlo después le
    // borraría el `isInvalidated: false` que le acaba de dejar su refetch —
    // la ficha se quedaría marcada vieja y volvería a pedirse al primer foco.
    queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all, refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: queryKeys.achievements.game(event.gameId) });
  };
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
