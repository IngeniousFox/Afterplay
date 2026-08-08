import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type {
  ExternalDataStatus,
  ExternalRefreshEvent,
  GameFullRefreshResult,
  RatingsRefreshResult,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Datos externos (PLAN-TO-PLAY.md §5): notas, sinopsis, fecha completa y
// sagas de IGDB + etiquetas y reseñas de Steam. Un mecanismo, dos puertas.
//
// El estado de la pasada NO vive en ningún componente, y esa es la clave de
// todo este archivo: las reseñas se piden juego a juego, así
// que con la biblioteca entera son MINUTOS. En ese rato cierras Ajustes, te
// vas al Plan o miras otra pantalla — y con un useMutation por componente,
// cada desmontaje se llevaba por delante el "Refreshing…" aunque el trabajo
// siguiera corriendo en el main, dejando el botón como si no pasara nada (y
// listo para arrancar una pasada duplicada). Ahora el candado y el progreso
// son del main, viajan por 'external:activity' y se guardan en la CACHÉ de
// TanStack, que sí sobrevive a los desmontajes.

// Estado para la tarjeta de Ajustes. staleTime corto en vez de Infinity: se
// abre poco y su verdad cambia por debajo (altas nuevas, refrescos de ficha).
export const useExternalDataStatus = (): UseQueryResult<ExternalDataStatus, Error> =>
  useQuery({
    queryKey: queryKeys.external.status,
    queryFn: () => window.api.external.status(),
    staleTime: 30_000,
  });

// El último evento de la pasada, leído de la caché. Cualquier pantalla puede
// llamarlo: no se suscribe a nada (de eso se encarga la suscripción única de
// abajo), solo lee lo que haya. `enabled: false` + queryFn de relleno porque
// esto no tiene de dónde "pedirse": su único origen es el evento del main.
export const useExternalRefreshProgress = (): ExternalRefreshEvent | null => {
  const { data } = useQuery<ExternalRefreshEvent | null>({
    queryKey: queryKeys.external.activity,
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });
  return data ?? null;
};

// La suscripción ÚNICA, montada en la raíz de la app (Afterplay.tsx). Vive
// ahí y no en Ajustes por lo mismo que useCuriositiesActivity: la pasada
// sobrevive al modal, así que su aviso tiene que sobrevivirlo también — y el
// toast de "ya está" tiene que llegarte estés donde estés.
export const useExternalRefreshActivity = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.external.onActivity((event) => {
      queryClient.setQueryData(queryKeys.external.activity, event);
      if (event.running) return;

      // Terminó: los datos viven en la fila de cada juego, así que se invalida
      // ['games'] entero — cualquier ficha o lista abierta debe verlos
      // frescos, sin importar en qué pantalla estuviera el usuario.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.external.status });

      if (event.error !== null) {
        toast.error("Couldn't refresh — data kept as it was.", { description: event.error });
        return;
      }
      const summary = event.summary;
      if (!summary || summary.total === 0) return;

      const where = event.scope === 'plan' ? 'Plan' : 'Library';
      const steam = summary.steamFound > 0 ? ` · Steam tags for ${summary.steamFound}` : '';
      toast.success(`${where} data refreshed`, {
        description: `${summary.withRatings} with ratings · ${summary.withSummary} with a summary · ${summary.withFullDate} with a full release date${steam}.`,
      });
    });
  }, [queryClient]);
};

// Las dos puertas comparten hook porque comparten TODO menos a qué juegos
// alcanzan. Devuelven cuántos juegos entran en la pasada y vuelven enseguida:
// el resto llega por los eventos de arriba, así que aquí NO hay onSuccess que
// invalide nada ni isPending del que fiarse — el "ocupado" de verdad es el
// del main.
const useExternalRefresh = (
  run: () => Promise<number>,
): UseMutationResult<number, Error, void, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    // Arrancar la pasada ya cambia `running` en el estado: se refresca para
    // que la tarjeta se vea ocupada aunque el primer evento tarde un pelín.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.external.status }),
  });
};

// Puerta 1 — Ajustes: biblioteca entera. Mantenimiento.
export const useRefreshAllExternalData = (): UseMutationResult<number, Error, void, unknown> =>
  useExternalRefresh(() => window.api.external.refreshAll());

// Puerta 2 — la cabecera del Plan: solo los planeados. La del día a día.
export const useRefreshPlanData = (): UseMutationResult<number, Error, void, unknown> =>
  useExternalRefresh(() => window.api.external.refreshPlan());

// Puerta 3 — el botón de la ficha: TODO lo externo de UN juego (notas,
// sinopsis, fecha, tiempos de HLTB, appid, etiquetas y reseñas de Steam, y
// los logros). A diferencia de las otras dos, esta SÍ es un useMutation
// normal con su isPending: son segundos y no sobrevive a nada — si cierras la
// ficha, tampoco hay ya botón al que devolverle el estado.
export const useRefreshGameEverything = (): UseMutationResult<
  GameFullRefreshResult | null,
  Error,
  number,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => window.api.external.refreshGame(gameId),
    onSuccess: () => {
      // Todo lo que toca vive en la fila del juego, salvo los logros, que
      // tienen su propio árbol. La cobertura de Ajustes también se mueve: este
      // juego puede acabar de entrar en "con notas" o en "con etiquetas".
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.external.status });
    },
  });
};

// Puerta 4 — el ⟳ de la card Ratings: solo las notas que esa card enseña, las
// de IGDB y el % de Steam.
//
// Invalida ['games'] porque las notas viven en la fila del juego, no en una
// query propia: la card las lee de `game.ratingCritics`/`ratingUsers`/
// `steamPositive` — mismo motivo que useRefreshGameHltb.
export const useRefreshGameRatings = (): UseMutationResult<
  RatingsRefreshResult | null,
  Error,
  number,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => window.api.external.refreshRatings(gameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      // El conteo de Ajustes también cambia: este juego puede haber pasado
      // de "sin notas" a "con notas".
      queryClient.invalidateQueries({ queryKey: queryKeys.external.status });
    },
  });
};

// ¿Hay una pasada en marcha? Combina las dos fuentes a propósito: el evento
// (inmediato, pero solo existe si ha llegado alguno en esta sesión) y el
// `running` del estado (que cubre el caso de montar la pantalla con la pasada
// YA corriendo — abrir Ajustes a mitad, o volver al Plan desde otra sección).
export const useIsExternalRefreshRunning = (): boolean => {
  const progress = useExternalRefreshProgress();
  const { data: status } = useExternalDataStatus();
  return progress !== null ? progress.running : (status?.running ?? false);
};
