import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GameRatings,
  IgdbGameDetail,
  IgdbSearchResult,
  RatingsRefreshSummary,
  RatingsStatus,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.igdb.ratingsStatus });
    },
  });
};

// Estado del bloque Ratings de Ajustes — cuántos juegos tienen alguna nota y
// cuántos no se han preguntado nunca. staleTime corto en vez de Infinity: se
// abre poco y su verdad cambia por debajo (altas nuevas, refrescos de ficha).
export const useRatingsStatus = (): UseQueryResult<RatingsStatus, Error> =>
  useQuery({
    queryKey: queryKeys.igdb.ratingsStatus,
    queryFn: () => window.api.igdb.ratingsStatus(),
    staleTime: 30_000,
  });

// El "Refresh all" de Ajustes: pone al día las notas de TODA la biblioteca
// en 1-2 peticiones por lotes. Invalida ['games'] entero — las notas viven
// en la fila de cada juego y cualquier ficha abierta debe verlas frescas.
export const useRefreshAllRatings = (): UseMutationResult<
  RatingsRefreshSummary,
  Error,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => window.api.igdb.refreshAllRatings(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.igdb.ratingsStatus });
    },
  });
};
