import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { PairRequest, SyncStatus } from '../../../shared/sync/status';
import { queryKeys } from './queryKeys';

// El estado del sync de este PC (main/sync/runtime.ts). Se vuelve a pedir
// cuando el main avisa de que cambió (ciclo terminado, emparejado…) y cada
// medio minuto como red de seguridad: la hora del "último sync" envejece sola.
export const useSyncStatus = (): UseQueryResult<SyncStatus, Error> => {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.api.sync.onStatus(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sync.status });
      }),
    [queryClient],
  );
  return useQuery({
    queryKey: queryKeys.sync.status,
    queryFn: () => window.api.sync.getStatus(),
    refetchInterval: 30_000,
  });
};

export type PairOutcome = { ok: true } | { ok: false; message: string };

export const usePairSync = (): UseMutationResult<PairOutcome, Error, PairRequest, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request) => {
      const result = await window.api.sync.pair(request);
      if (result.ok) queryClient.setQueryData(queryKeys.sync.status, result.status);
      return result.ok ? { ok: true } : result;
    },
  });
};

export const useUnpairSync = (): UseMutationResult<SyncStatus, Error, void, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => window.api.sync.unpair(),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.sync.status, status),
  });
};

export const useSyncNow = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.sync.syncNow() });
