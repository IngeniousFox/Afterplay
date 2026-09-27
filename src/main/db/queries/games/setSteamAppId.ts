import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameRow } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { achievementUnlocksTable, achievementsTable, gamesTable } from '../../schema';

export const setSteamAppId = async (gameId: number, appId: number): Promise<GameRow | null> => {
  if (!Number.isSafeInteger(appId) || appId < 1 || appId > 0xffffffff) {
    throw new Error('Invalid Steam App ID.');
  }

  return getDb().transaction(async (tx) => {
    const [game] = await tx
      .select(gameColumns)
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);
    if (!game) return null;

    if (game.steamAppId !== appId) {
      // El catálogo del App ID erróneo no puede mezclarse con el nuevo.
      // RetroAchievements comparte esta tabla, pero sus filas son independientes.
      const definitions = await tx
        .select({
          id: achievementsTable.id,
          apiName: achievementsTable.apiName,
          iconUrl: achievementsTable.iconUrl,
        })
        .from(achievementsTable)
        .where(eq(achievementsTable.gameId, gameId));
      const allIds = definitions.map((row) => row.id);
      const raUnlocks = allIds.length
        ? await tx
            .select({ achievementId: achievementUnlocksTable.achievementId })
            .from(achievementUnlocksTable)
            .where(
              and(
                inArray(achievementUnlocksTable.achievementId, allIds),
                eq(achievementUnlocksTable.source, 'ra'),
              ),
            )
        : [];
      const raIds = new Set(raUnlocks.map((row) => row.achievementId));
      const steamIds = definitions
        .filter(
          (row) =>
            !raIds.has(row.id) &&
            !row.iconUrl?.startsWith('https://media.retroachievements.org/Badge/') &&
            !(game.raGameId !== null && /^\d+$/.test(row.apiName)),
        )
        .map((row) => row.id);
      if (steamIds.length) {
        await tx.delete(achievementsTable).where(inArray(achievementsTable.id, steamIds));
      }
    }

    const [updated] = await tx
      .update(gamesTable)
      .set({
        steamAppId: appId,
        steamAppIdManual: true,
        steamAppIdCheckedAt: new Date(),
        ...(game.steamAppId !== appId
          ? {
              achievementsSyncedAt: null,
              achievementsUnlocksSyncedAt: null,
              steamTags: null,
              steamPositive: null,
              steamNegative: null,
              steamSpyCheckedAt: null,
            }
          : {}),
      })
      .where(eq(gamesTable.id, gameId))
      .returning(gameColumns);
    return updated ?? null;
  });
};
