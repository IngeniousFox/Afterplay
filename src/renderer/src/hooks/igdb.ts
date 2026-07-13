import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { IgdbGameDetail, IgdbSearchResult } from '../../../shared/types';
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
