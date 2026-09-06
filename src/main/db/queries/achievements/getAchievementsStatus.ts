import { count, countDistinct, isNotNull, or, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { AchievementsStatus } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';

// Números de la tarjeta de Ajustes. Cuenta juegos ELEGIBLES (con appid de
// Steam O emparejados con RetroAchievements) y no todos: un juego sin
// ninguna de las dos vías no puede tener logros, y meterlo en el denominador
// daría un "300/333" permanentemente incompleto que parecería un fallo. El
// caso real que obligó a sumar RA: la tarjeta llegó a decir "541 de 527" —
// juegos de RA sincronizados que el denominador solo-Steam no contaba.
export const getAchievementsStatus = async (
  running: boolean,
  failedGames: number,
): Promise<AchievementsStatus> => {
  const db = getDb();
  const total = db.select({ n: count() }).from(achievementsTable);
  const unlocked = db
    .select({ n: countDistinct(achievementUnlocksTable.achievementId) })
    .from(achievementUnlocksTable);

  // Ambos contadores leen la misma población: una pasada, sin multiplicar
  // juegos con ambas fuentes. COUNT(columna) conserva también sellos epoch 0.
  // Catálogo y desbloqueos son subconsultas escalares independientes: una
  // sola respuesta coherente, sin JOIN que multiplique logros por fuente.
  const [counts] = await db
    .select({
      eligible:
        sql<number>`count(case when ${or(isNotNull(gamesTable.steamAppId), isNotNull(gamesTable.raGameId))} then 1 end)`.mapWith(
          Number,
        ),
      synced: count(gamesTable.achievementsSyncedAt),
      total: sql<number>`(${total})`.mapWith(Number),
      unlocked: sql<number>`(${unlocked})`.mapWith(Number),
    })
    .from(gamesTable);

  return {
    eligibleGames: counts?.eligible ?? 0,
    syncedGames: counts?.synced ?? 0,
    totalAchievements: counts?.total ?? 0,
    unlockedAchievements: counts?.unlocked ?? 0,
    running,
    hasApiKey: Boolean(process.env.STEAM_API_KEY),
    hasUserId: Boolean(process.env.STEAM_USER_ID64),
    hasRaCredentials: Boolean(process.env.RA_USERNAME && process.env.RA_API_KEY),
    failedGames,
  };
};
