import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { HltbTimes } from '../../../shared/types';
import { queryKeys } from './queryKeys';

export const useHltbTimes = (
  title: string,
  releaseYear: number | null,
): UseQueryResult<HltbTimes | null, Error> => {
  const trimmed = title.trim();

  return useQuery({
    queryKey: queryKeys.hltb.times(trimmed, releaseYear),
    queryFn: () => window.api.hltb.getTimes(trimmed, releaseYear),
    enabled: trimmed.length > 0,
    staleTime: Infinity, // los tiempos de HLTB no cambian durante la sesión de uso
  });
};
