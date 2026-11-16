import { invoke } from '../ipc';
import type { JourneyEntrySummary } from '../../shared/domain/journeyEntries';
import type { SessionStats } from '../../shared/domain/sessionStats';

// Agregados de las Estadísticas calculados en el main (§15.6, F-41).
export const statsApi = {
  getSessionStats: (): Promise<SessionStats> => invoke('stats:getSessionStats'),
  getJourney: (): Promise<JourneyEntrySummary[]> => invoke('stats:getJourney'),
};
