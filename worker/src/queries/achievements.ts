import { asc, eq } from 'drizzle-orm';
import {
  achievementsTable,
  achievementUnlocksTable,
  curiositiesTable,
  gamesTable,
} from '../../../src/main/db/schema';
import type { AchievementEntry, AchievementSource, GameAchievements } from '../api-types';
import type { TenantDb } from '../db';

// Los logros de un juego, con las fuentes YA FUNDIDAS (LOGROS.md §2).
//
// El diseño del escritorio es que un desbloqueo es un HECHO CON ORIGEN, no un
// booleano: el mismo logro puede constar por Steam y por el fichero de un
// emulador —jugaste una vuelta pirata y luego lo compraste— y las dos cosas
// son ciertas a la vez. Se guardan por separado y se funden al leer.
//
// Portado entero, incluida la regla de desempate, porque no es obvia: una
// fuente CON fecha fiable gana siempre a una sin ella, por temprana que sea
// esta. El caso real es tener el logro por el arrastre masivo del crack (con
// fecha inventada de hoy) y también por Steam con su fecha de verdad — la
// buena es la de Steam aunque sea posterior.
export const getGameAchievements = async (
  db: TenantDb,
  gameId: number,
): Promise<GameAchievements> => {
  const [game] = await db
    .select({
      steamAppId: gamesTable.steamAppId,
      syncedAt: gamesTable.achievementsSyncedAt,
      unlocksSyncedAt: gamesTable.achievementsUnlocksSyncedAt,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);

  const empty: GameAchievements = {
    gameId,
    steamAppId: game?.steamAppId ?? null,
    syncedAt: game?.syncedAt ? game.syncedAt.getTime() : null,
    unlocksSyncedAt: game?.unlocksSyncedAt ? game.unlocksSyncedAt.getTime() : null,
    entries: [],
  };
  if (!game) return empty;

  const definitions = await db
    .select({
      id: achievementsTable.id,
      apiName: achievementsTable.apiName,
      displayName: achievementsTable.displayName,
      description: achievementsTable.description,
      iconUrl: achievementsTable.iconUrl,
      iconGrayUrl: achievementsTable.iconGrayUrl,
      hidden: achievementsTable.hidden,
      globalPercent: achievementsTable.globalPercent,
    })
    .from(achievementsTable)
    .where(eq(achievementsTable.gameId, gameId))
    .orderBy(asc(achievementsTable.sortIndex));

  if (definitions.length === 0) return empty;

  const unlocks = await db
    .select({
      achievementId: achievementUnlocksTable.achievementId,
      unlockedAt: achievementUnlocksTable.unlockedAt,
      dateReliable: achievementUnlocksTable.dateReliable,
      source: achievementUnlocksTable.source,
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    .where(eq(achievementsTable.gameId, gameId));

  type Merged = { unlockedAt: Date; dateReliable: boolean; sources: AchievementSource[] };
  const mergedById = new Map<number, Merged>();

  for (const unlock of unlocks) {
    const existing = mergedById.get(unlock.achievementId);
    if (!existing) {
      mergedById.set(unlock.achievementId, {
        unlockedAt: unlock.unlockedAt,
        dateReliable: unlock.dateReliable,
        sources: [unlock.source],
      });
      continue;
    }

    existing.sources.push(unlock.source);

    if (unlock.dateReliable && !existing.dateReliable) {
      existing.unlockedAt = unlock.unlockedAt;
      existing.dateReliable = true;
      continue;
    }
    if (!unlock.dateReliable && existing.dateReliable) continue;

    // Empatadas en fiabilidad: manda la más temprana. La pregunta que responde
    // la ficha es "¿cuándo hiciste esto por primera vez?", y esa respuesta no
    // cambia porque después lo compraras en Steam.
    if (unlock.unlockedAt.getTime() < existing.unlockedAt.getTime()) {
      existing.unlockedAt = unlock.unlockedAt;
    }
  }

  const entries: AchievementEntry[] = definitions.map((definition) => {
    const merged = mergedById.get(definition.id);
    return {
      ...definition,
      unlockedAt: merged ? merged.unlockedAt.getTime() : null,
      dateReliable: merged?.dateReliable ?? true,
      sources: merged?.sources ?? [],
    };
  });

  return { ...empty, entries };
};

// Las curiosidades generadas para un juego. Texto suelto, sin más estructura.
export const getCuriosities = async (db: TenantDb, gameId: number): Promise<string[]> => {
  const rows = await db
    .select({ text: curiositiesTable.text })
    .from(curiositiesTable)
    .where(eq(curiositiesTable.gameId, gameId))
    .orderBy(asc(curiositiesTable.id));
  return rows.map((row) => row.text);
};
