import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getGameAchievements } from '../db/queries/achievements/getGameAchievements';
import { getSteamAchievementsStatus, runAchievementsBackfill } from '../steam/backfill';
import { requestAchievementsStop, retryFailedAchievements } from '../steam/queue';
import { replaceUnlockPlacements } from '../steam/syncAchievements';

export const registerAchievementsHandlers = (): void => {
  handleDb('achievements:getForGame', async (_event, gameId: number) =>
    getGameAchievements(gameId),
  );

  handleDb('achievements:getStatus', async () => getSteamAchievementsStatus());

  // Encola y devuelve cuántos juegos entraron: la sincronización va de uno en
  // uno por la cola (steam/queue.ts) y su progreso viaja por el canal de
  // eventos 'achievements:activity', no por esta respuesta — una pasada de
  // 300 juegos tarda minutos y ningún invoke debe colgarse tanto.
  ipcMain.handle('achievements:sync', (_event, full: boolean) => runAchievementsBackfill(full));

  ipcMain.handle('achievements:stop', () => {
    requestAchievementsStop();
  });

  // Reintentar solo los que fallaron, sin repetir la pasada entera.
  ipcMain.handle('achievements:retryFailed', () => retryFailedAchievements());

  // Recolocar los desbloqueos ya guardados sobre las sesiones actuales, sin
  // tocar la red — para cuando se corrigen fechas o se asigna a mano una
  // sesión de emulador.
  handleDb('achievements:replacePlacements', async (_event, gameId: number) =>
    replaceUnlockPlacements(gameId),
  );
};
