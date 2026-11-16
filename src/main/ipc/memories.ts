import type { GeneratedMemorySummary } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import { getLatestMemories } from '../db/v2/queries/loop';
import {
  getMemoriesStatus,
  regenerateStaleMemories,
  runMemoriesBackfill,
} from '../memories/backfill';
import { requestMemoriesStop } from '../memories/queue';
import { handle } from './contractHandlers';

export const registerMemoriesHandlers = (): void => {
  // El último recap de cada periodo — lo que el Journey y Sessions pintan.
  // El sourceHash se queda en el main: al renderer solo le importa la prosa.
  handle('memories:getAll', async (): Promise<GeneratedMemorySummary[]> => {
    const latest = getLatestMemories(appCtx());
    return latest.map(({ scopeType, scopeKey, payload, createdAt }) => ({
      scopeType,
      scopeKey,
      payload,
      createdAt,
    }));
  });

  // getStatus/backfill/regenerate hacen sus propias lecturas con withDbAccess
  // por dentro (computeMemoriesOverview): handle a secas, como el
  // runBackfill de curiosidades — el progreso viaja por 'memories:activity',
  // no por estas respuestas.
  handle('memories:getStatus', () => getMemoriesStatus());
  handle('memories:runBackfill', () => runMemoriesBackfill());
  handle('memories:regenerateStale', () => regenerateStaleMemories());

  // "Stop after this one": el periodo en vuelo se termina (ya está pagado),
  // el resto se suelta y queda pendiente para otra pasada.
  handle('memories:stop', () => {
    requestMemoriesStop();
  });
};
