import { handle } from './contractHandlers';
import { appCtx } from '../db/v2/appDb';
import { getJourneyEntries, getSessionStats } from '../db/v2/queries/stats';

// Estadísticas agregadas en el main (AFTERPLAY-2.0.md §15.6, F-41): el
// renderer deja de recorrer todas las sesiones y recibe el resumen ya hecho.
export const registerStatsHandlers = (): void => {
  handle('stats:getSessionStats', async () => {
    return getSessionStats(appCtx());
  });

  handle('stats:getJourney', async () => {
    return getJourneyEntries(appCtx());
  });
};
