import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { AchievementEntry, GameAchievements } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';
import { mergeUnlocksByAchievement } from './mergeUnlocks';

// Los logros de un juego, con las fuentes YA FUNDIDAS (LOGROS.md §2).
//
// Aquí es donde el diseño de "un desbloqueo es un hecho con origen" se paga
// solo: la ficha no tiene que saber nada de Steam ni de emuladores, recibe
// una lista de logros donde cada uno o está desbloqueado o no. Si el mismo
// logro consta por varias fuentes gana la MÁS TEMPRANA de las que traen fecha
// fiable — porque la pregunta que responde la ficha es "¿cuándo hiciste esto
// por primera vez?", y esa respuesta no cambia porque después lo compraras en
// Steam, pero tampoco puede contestarla la fecha inventada de un rescate. El
// desempate entero está en mergeUnlocks.ts.
export const getGameAchievements = async (gameId: number): Promise<GameAchievements> => {
  const db = getDb();

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
    syncedAt: game?.syncedAt ?? null,
    unlocksSyncedAt: game?.unlocksSyncedAt ?? null,
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

  // Todos los desbloqueos del juego, sin agregar: la fusión por logro se hace
  // en JS — es una lista corta (los logros de UN juego) y así la regla vive en
  // un solo sitio legible.
  const unlocks = await db
    .select({
      achievementId: achievementUnlocksTable.achievementId,
      unlockedAt: achievementUnlocksTable.unlockedAt,
      dateReliable: achievementUnlocksTable.dateReliable,
      source: achievementUnlocksTable.source,
      sessionId: achievementUnlocksTable.sessionId,
      iterationId: achievementUnlocksTable.iterationId,
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    .where(eq(achievementsTable.gameId, gameId));

  // El fundido multi-fuente sale de mergeUnlocks.ts y ya no de una copia a
  // mano: la fila GANADORA representa al logro —y con ella viajan SU sesión y
  // SU playthrough, que es lo que hace que el historial de sesiones de la
  // ficha cuelgue el trofeo del rato correcto—, y `rows` da la lista entera de
  // fuentes, que la ficha necesita completa aunque solo pinte algo cuando
  // ninguna es Steam (el sello "local" / "RA" de AchievementsSection). Es la
  // única consulta que usa las dos mitades del helper.
  const mergedById = mergeUnlocksByAchievement(unlocks);

  const entries: AchievementEntry[] = definitions.map((definition) => {
    const merged = mergedById.get(definition.id);
    return {
      id: definition.id,
      apiName: definition.apiName,
      displayName: definition.displayName,
      // Sin filtrar por `hidden`: Steam NUNCA manda la descripción de un
      // logro oculto por la Web API — ni en el catálogo ni en la respuesta de
      // jugador, ni siquiera en los que ya tienes desbloqueados (comprobado
      // en vivo: devuelve ""). Así que aquí ya llega null de origen y
      // esconderla "hasta desbloquearla" era código que no podía ejecutarse.
      description: definition.description,
      iconUrl: definition.iconUrl,
      iconGrayUrl: definition.iconGrayUrl,
      hidden: definition.hidden,
      globalPercent: definition.globalPercent,
      unlockedAt: merged?.winner.unlockedAt ?? null,
      dateReliable: merged?.winner.dateReliable ?? true,
      sources: merged?.rows.map((row) => row.source) ?? [],
      sessionId: merged?.winner.sessionId ?? null,
      iterationId: merged?.winner.iterationId ?? null,
    };
  });

  return { ...empty, entries };
};
