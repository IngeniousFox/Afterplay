import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { JourneyEntrySummary } from '../../../shared/domain/journeyEntries';
import type { SessionStats } from '../../../shared/domain/sessionStats';
import { queryKeys } from './queryKeys';

// Los agregados que el main calcula para las Estadísticas (§15.6, F-41): el
// renderer ya no recorre las sesiones de la biblioteca, lee este resumen.
// staleTime Infinity, como el resto: lo refresca 'data:changed' (ver
// domainQueryKeys: sesiones, juegos, playthroughs, eventos de estado y gasto).
export const sessionStatsQueryOptions = {
  queryKey: queryKeys.stats.sessions,
  queryFn: () => window.api.stats.getSessionStats(),
  staleTime: Infinity,
};

export const useSessionStats = (): UseQueryResult<SessionStats, Error> =>
  useQuery(sessionStatsQueryOptions);

// Las carátulas del Journey (sin sus sesiones: el rastro del panel flotante se
// pide por juego, ver useGameSessions).
export const journeyQueryOptions = {
  queryKey: queryKeys.stats.journey,
  queryFn: () => window.api.stats.getJourney(),
  staleTime: Infinity,
};

export const useJourneyEntries = (): UseQueryResult<JourneyEntrySummary[], Error> =>
  useQuery(journeyQueryOptions);
