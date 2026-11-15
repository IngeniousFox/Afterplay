import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { scopesForTables, type ChangeScope } from '../../../shared/sync/changeScopes';
import { queryKeys } from './queryKeys';

// El refresco tras una DESCARGA del sync (AFTERPLAY-2.0.md §15.4): el motor
// cambió filas de ciertas tablas sin que el renderer hiciera nada, así que sus
// consultas cacheadas están viejas. Montado UNA vez en la raíz (Afterplay.tsx):
// la descarga ocurre estés en la pantalla que estés.
//
// Cada ámbito (shared/sync/changeScopes.ts) se traduce a las claves que
// existen; invalidar el prefijo basta (TanStack invalida por prefijo, ver
// queryKeys.ts). Solo se refetchean las consultas ACTIVAS: las demás quedan
// marcadas como viejas y se piden al montarse.
const KEYS_BY_SCOPE: Readonly<Record<ChangeScope, readonly QueryKey[]>> = {
  games: [queryKeys.games.all],
  sessions: [queryKeys.sessions.all],
  stateEvents: [queryKeys.stateEvents.all],
  spend: [queryKeys.spend.all],
  emulators: [queryKeys.emulators.all],
  saves: [queryKeys.saves.all],
  achievements: [queryKeys.achievements.all],
  curiosities: [queryKeys.curiosities.all],
  memories: [queryKeys.memories.all],
  radar: [queryKeys.radar.all],
  external: [queryKeys.external.status],
};

/** Las claves a invalidar para estas tablas, sin repetir. */
export const queryKeysForTables = (tables: readonly string[]): QueryKey[] => {
  const keys = new Map<string, QueryKey>();
  for (const scope of scopesForTables(tables)) {
    for (const key of KEYS_BY_SCOPE[scope]) keys.set(JSON.stringify(key), key);
  }
  return [...keys.values()];
};

export const createSyncChangeInvalidator =
  (queryClient: QueryClient) =>
  (tables: readonly string[]): void => {
    for (const queryKey of queryKeysForTables(tables)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

export const useSyncChangesSync = (): void => {
  const queryClient = useQueryClient();

  useEffect(
    () => window.api.sync.onChanged(createSyncChangeInvalidator(queryClient)),
    [queryClient],
  );
};
