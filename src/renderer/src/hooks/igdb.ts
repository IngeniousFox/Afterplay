import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { IgdbSearchResult } from '../../../shared/types';
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
