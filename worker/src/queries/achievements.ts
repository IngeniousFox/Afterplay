import { asc, eq } from 'drizzle-orm';
import {
  achievementsTable,
  achievementUnlocksTable,
  curiositiesTable,
  gamesTable,
} from '../../../src/main/db/schema';
import { mergeUnlocksByAchievement } from '../../../src/shared/mergeUnlocks';
import type { AchievementEntry, GameAchievements } from '../api-types';
import type { TenantDb } from '../db';

// Los logros de un juego, con las fuentes YA FUNDIDAS (LOGROS.md §2).
//
// El diseño del escritorio es que un desbloqueo es un HECHO CON ORIGEN, no un
// booleano: el mismo logro puede constar por Steam y por el fichero de un
// emulador —jugaste una vuelta pirata y luego lo compraste— y las dos cosas
// son ciertas a la vez. Se guardan por separado y se funden al leer.
//
// El desempate NO se porta: se IMPORTA (mergeUnlocksByAchievement, src/shared).
// Aquí había una copia a mano término a término, y la cabecera de este fichero
// presumía de haberla "portado entera, incluida la regla de desempate" — que es
// la confesión. La regla no es obvia (una fuente CON fecha fiable gana siempre a
// una sin ella, por temprana que sea esta) y tiene una decisión pendiente encima
// —RETROACHIEVEMENTS.md §8, hardcore contra softcore— que la va a cambiar. El
// día que se cambie, esta ficha del móvil habría seguido fechando los logros con
// el criterio viejo sin que nada fallara al compilar.
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

  // La ganadora decide la FECHA y la fiabilidad; las fuentes se enumeran todas,
  // en el orden en que llegaron. Que un logro conste por dos sitios no es un
  // duplicado que haya que resolver a favor de uno: las dos cosas pasaron.
  const mergedById = mergeUnlocksByAchievement(unlocks);

  const entries: AchievementEntry[] = definitions.map((definition) => {
    const merged = mergedById.get(definition.id);
    return {
      ...definition,
      unlockedAt: merged ? merged.winner.unlockedAt.getTime() : null,
      dateReliable: merged?.winner.dateReliable ?? true,
      sources: merged?.rows.map((row) => row.source) ?? [],
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
