import { isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { AchievementsStatus } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';

// Números de la tarjeta de Ajustes. Cuenta juegos ELEGIBLES (con appid de
// Steam) y no todos: los emulados de consola no pueden tener logros por esta
// vía, y meterlos en el denominador daría un "300/333" permanentemente
// incompleto que parecería un fallo.
export const getAchievementsStatus = async (
  running: boolean,
  failedGames: number,
): Promise<AchievementsStatus> => {
  const db = getDb();

  const [eligible] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gamesTable)
    .where(isNotNull(gamesTable.steamAppId));

  const [synced] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gamesTable)
    .where(isNotNull(gamesTable.achievementsSyncedAt));

  const [total] = await db.select({ n: sql<number>`count(*)` }).from(achievementsTable);

  const [unlocked] = await db
    .select({ n: sql<number>`count(distinct ${achievementUnlocksTable.achievementId})` })
    .from(achievementUnlocksTable);

  return {
    eligibleGames: eligible?.n ?? 0,
    syncedGames: synced?.n ?? 0,
    totalAchievements: total?.n ?? 0,
    unlockedAchievements: unlocked?.n ?? 0,
    running,
    hasApiKey: Boolean(process.env.STEAM_API_KEY),
    hasUserId: Boolean(process.env.STEAM_USER_ID64),
    failedGames,
  };
};
