import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CollectionGame,
  GameRatings,
  IgdbGameDetail,
  IgdbSearchResult,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useDebouncedValue } from './useDebouncedValue';

// Espera 300ms tras la última pulsación antes de disparar la búsqueda —
// si no, cada tecla mientras escribes el título dispararía su propia
// petición a IGDB.
export const useIgdbSearch = (query: string): UseQueryResult<IgdbSearchResult[], Error> => {
  const debouncedQuery = useDebouncedValue(query, 300);
  const trimmed = debouncedQuery.trim();

  return useQuery({
    queryKey: queryKeys.igdb.search(trimmed),
    queryFn: () => window.api.igdb.search(trimmed),
    enabled: trimmed.length > 0,
  });
};

// Trae covers/heroes/screenshots del detalle de IGDB — lo usa el CoverPicker
// (SPEC 4.6) para tener candidatas más allá de la única carátula que ya trae
// el resultado de búsqueda. El detalle de un igdbId no cambia durante la
// sesión, así que staleTime: Infinity evita refetch si se reabre el picker.
export const useIgdbDetails = (
  igdbId: number | null,
): UseQueryResult<IgdbGameDetail | null, Error> =>
  useQuery({
    queryKey: queryKeys.igdb.details(igdbId),
    queryFn: () => window.api.igdb.getById(igdbId as number),
    enabled: igdbId !== null,
    staleTime: Infinity,
  });

// Los juegos de la saga (PLAN-TO-PLAY.md §3.5) — bajo demanda al abrir la
// ficha. staleTime largo pero NO Infinity: es dato de catálogo ajeno que
// puede crecer cualquier semana (justo el caso que el radar existe para
// cazar), pero desde luego no cambia entre dos visitas seguidas a la ficha.
// El main tiene además su propia caché TTL, así que esto solo evita el
// viaje por IPC.
export const useCollectionGames = (
  collectionIds: number[],
): UseQueryResult<CollectionGame[], Error> => {
  // Ordenados en la key: el mismo juego devuelve sus colecciones en cualquier
  // orden y no queremos dos entradas de caché para la misma pregunta.
  const key = [...collectionIds].sort((a, b) => a - b);
  return useQuery({
    queryKey: queryKeys.igdb.collection(key),
    queryFn: () => window.api.igdb.collectionGames(key),
    enabled: key.length > 0,
    staleTime: 10 * 60 * 1000,
  });
};

// Vuelve a pedir las notas de UN juego ya dado de alta y las guarda.
//
// Invalida ['games'] porque las notas viven en la fila del juego, no en una
// query propia de IGDB: RatingsRow las lee de `game.ratingCritics`/
// `ratingUsers` — mismo motivo que useRefreshGameHltb.
export const useRefreshGameRatings = (): UseMutationResult<
  GameRatings | null,
  Error,
  number,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => window.api.igdb.refreshRatings(gameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      // El conteo de Ajustes también cambia: este juego puede haber pasado
      // de "sin notas" a "con notas".
      queryClient.invalidateQueries({ queryKey: queryKeys.external.status });
    },
  });
};
