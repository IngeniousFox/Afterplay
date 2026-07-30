import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  ResolveSessionEpilogueInput,
  SessionEpilogue,
  SessionEpilogueSummary,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

export const usePendingSessionEpilogues = (): UseQueryResult<SessionEpilogueSummary[], Error> =>
  useQuery({
    queryKey: queryKeys.sessionEpilogues.pending,
    queryFn: () => window.api.sessionEpilogues.getPending(),
    staleTime: Infinity,
  });

export const useSessionEpilogue = (
  id: number | null,
): UseQueryResult<SessionEpilogueSummary | null, Error> =>
  useQuery({
    queryKey: queryKeys.sessionEpilogues.detail(id),
    queryFn: () => (id === null ? Promise.resolve(null) : window.api.sessionEpilogues.getById(id)),
    enabled: id !== null,
    staleTime: Infinity,
  });

export const useResolveSessionEpilogue = (): UseMutationResult<
  SessionEpilogue | null,
  Error,
  ResolveSessionEpilogueInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: ResolveSessionEpilogueInput) => window.api.sessionEpilogues.resolve(input),
    [queryKeys.sessionEpilogues.all],
  );
