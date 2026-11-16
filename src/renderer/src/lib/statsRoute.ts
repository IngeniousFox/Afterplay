import { plannedGamesQueryOptions } from '../hooks/games';
import { spendQueryOptions } from '../hooks/spend';
import { journeyQueryOptions, sessionStatsQueryOptions } from '../hooks/stats';
import { stateEventsQueryOptions } from '../hooks/stateEvents';
import { queryClient } from './queryClient';

type StatsRoute = { Component: typeof import('../screens/Stats').Stats };

let pending: Promise<StatsRoute> | undefined;

export const loadStatsRoute = (): Promise<StatsRoute> => {
  pending ??= import('../screens/Stats')
    .then(({ Stats }) => ({ Component: Stats }))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
};

// Reuse the exact queries and invalidation rules used by the screen. This only
// reads local data; it does not mount charts or start integrations.
export const preloadStatsRoute = (): void => {
  void loadStatsRoute().catch(() => {});
  void queryClient.prefetchQuery(plannedGamesQueryOptions);
  void queryClient.prefetchQuery(sessionStatsQueryOptions);
  void queryClient.prefetchQuery(journeyQueryOptions);
  void queryClient.prefetchQuery(spendQueryOptions);
  void queryClient.prefetchQuery(stateEventsQueryOptions);
};

export const scheduleStatsPreload = (): void => {
  window.requestIdleCallback(preloadStatsRoute, { timeout: 500 });
};
