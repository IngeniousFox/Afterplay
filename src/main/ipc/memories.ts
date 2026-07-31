import { ipcMain } from 'electron';
import type { GeneratedMemorySummary } from '../../shared/types';
import { getLatestMemories } from '../db/queries/memories/getLatestMemories';
import {
  getMemoriesStatus,
  regenerateStaleMemories,
  runMemoriesBackfill,
} from '../memories/backfill';
import { requestMemoriesStop } from '../memories/queue';
import { handleDb } from './dbHandle';

export const registerMemoriesHandlers = (): void => {
  // El último recap de cada periodo — lo que el Journey y Sessions pintan.
  // El sourceHash se queda en el main: al renderer solo le importa la prosa.
  handleDb('memories:getAll', async (): Promise<GeneratedMemorySummary[]> => {
    const latest = await getLatestMemories();
    return latest.map(({ scopeType, scopeKey, payload, createdAt }) => ({
      scopeType,
      scopeKey,
      payload,
      createdAt,
    }));
  });

  // getStatus/backfill/regenerate hacen sus propias lecturas con withDbAccess
  // por dentro (computeMemoriesOverview): ipcMain.handle a secas, como el
  // runBackfill de curiosidades — el progreso viaja por 'memories:activity',
  // no por estas respuestas.
  ipcMain.handle('memories:getStatus', () => getMemoriesStatus());
  ipcMain.handle('memories:runBackfill', () => runMemoriesBackfill());
  ipcMain.handle('memories:regenerateStale', () => regenerateStaleMemories());

  // "Stop after this one": el periodo en vuelo se termina (ya está pagado),
  // el resto se suelta y queda pendiente para otra pasada.
  ipcMain.handle('memories:stop', () => {
    requestMemoriesStop();
  });
};
