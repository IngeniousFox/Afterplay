import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { handleDb } from './dbHandle';
import { getDb } from '../db';
import { achievementsTable, gamesTable } from '../db/schema';
import {
  isAchievementDemoRunning,
  startAchievementDemo,
  stopAchievementDemo,
} from '../steam/notifications/overlay';
import { getGameAchievements } from '../db/queries/achievements/getGameAchievements';
import { getHiddenDescriptions } from '../steam/hiddenDescriptions';
import { getSteamAchievementsStatus, runAchievementsBackfill } from '../steam/backfill';
import { requestAchievementsStop, retryFailedAchievements } from '../steam/queue';
import { replaceUnlockPlacements } from '../steam/syncAchievements';

export const registerAchievementsHandlers = (): void => {
  handleDb('achievements:getForGame', async (_event, gameId: number) => {
    const data = await getGameAchievements(gameId);

    // Los ocultos que siguen mudos tras las dos fuentes propias (la API de
    // Steam nunca los da; el schema local solo cubre juegos de tu cuenta).
    // Solo por esos se pregunta fuera, y solo si el juego está en Steam.
    const missing = data.entries.filter((entry) => entry.hidden && !entry.description);
    if (data.steamAppId === null || missing.length === 0) return data;

    const descriptions = await getHiddenDescriptions(data.steamAppId);
    if (descriptions.size === 0) return data;

    // Se rellena SOLO en la respuesta, nunca en la base de datos: es
    // información de un tercero sobre un juego, no un dato tuyo, y no tiene
    // por qué acabar en tu biblioteca ni viajar a Turso.
    return {
      ...data,
      entries: data.entries.map((entry) =>
        entry.hidden && !entry.description
          ? { ...entry, description: descriptions.get(entry.apiName) ?? null }
          : entry,
      ),
    };
  });

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

  // ⚠️ TEMPORAL — modo de prueba del aviso flotante (ver overlay.ts). Alterna
  // encendido/apagado y devuelve el estado nuevo. Quitar esto y su botón
  // cuando el diseño de la tarjeta esté cerrado.
  handleDb('achievements:toggleDemo', async () => {
    if (isAchievementDemoRunning()) {
      stopAchievementDemo();
      return false;
    }

    // Se tiran logros REALES de la biblioteca, con sus iconos y su rareza:
    // probar con datos inventados no enseña cómo queda de verdad (un título
    // largo, un icono oscuro, un 0.4% morado...).
    const pool = await getDb()
      .select({
        displayName: achievementsTable.displayName,
        iconUrl: achievementsTable.iconUrl,
        globalPercent: achievementsTable.globalPercent,
        gameTitle: gamesTable.title,
        gameHeroUrl: gamesTable.heroUrl,
      })
      .from(achievementsTable)
      .innerJoin(gamesTable, eq(achievementsTable.gameId, gamesTable.id))
      .limit(400);

    if (pool.length === 0) return false;
    startAchievementDemo(pool);
    return true;
  });

  // Recolocar los desbloqueos ya guardados sobre las sesiones actuales, sin
  // tocar la red — para cuando se corrigen fechas o se asigna a mano una
  // sesión de emulador.
  handleDb('achievements:replacePlacements', async (_event, gameId: number) =>
    replaceUnlockPlacements(gameId),
  );
};
