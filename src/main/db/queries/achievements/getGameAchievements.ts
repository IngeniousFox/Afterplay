import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type {
  AchievementEntry,
  AchievementSource,
  GameAchievements,
} from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';

// Los logros de un juego, con las fuentes YA FUNDIDAS (LOGROS.md §2).
//
// Aquí es donde el diseño de "un desbloqueo es un hecho con origen" se paga
// solo: la ficha no tiene que saber nada de Steam ni de emuladores, recibe
// una lista de logros donde cada uno o está desbloqueado o no. Si el mismo
// logro consta por varias fuentes, gana la fecha MÁS TEMPRANA — porque la
// pregunta que responde la ficha es "¿cuándo hiciste esto por primera vez?",
// y esa respuesta no cambia porque después lo compraras en Steam.
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
  // abajo en JS — es una lista corta (los logros de UN juego) y así la regla
  // de "gana la fecha más temprana" vive en un solo sitio legible.
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

  type Merged = {
    unlockedAt: Date;
    dateReliable: boolean;
    sources: AchievementSource[];
    sessionId: number | null;
    iterationId: number | null;
  };
  const mergedById = new Map<number, Merged>();

  for (const unlock of unlocks) {
    const existing = mergedById.get(unlock.achievementId);
    if (!existing) {
      mergedById.set(unlock.achievementId, {
        unlockedAt: unlock.unlockedAt,
        dateReliable: unlock.dateReliable,
        sources: [unlock.source],
        sessionId: unlock.sessionId,
        iterationId: unlock.iterationId,
      });
      continue;
    }

    existing.sources.push(unlock.source);

    // Una fuente CON fecha fiable gana siempre a una que no la tiene, por
    // temprana que sea esta: el caso real es tener el logro por el arrastre
    // masivo del crack (fecha inventada de hoy) y también por Steam con su
    // fecha de verdad — la buena es la de Steam, aunque sea posterior.
    if (unlock.dateReliable && !existing.dateReliable) {
      existing.unlockedAt = unlock.unlockedAt;
      existing.dateReliable = true;
      existing.sessionId = unlock.sessionId;
      existing.iterationId = unlock.iterationId;
      continue;
    }
    if (!unlock.dateReliable && existing.dateReliable) continue;

    // Empatadas en fiabilidad: manda la más temprana, y con ella viaja SU
    // sesión — la que importa es la de la primera vez, no la de la repetición.
    if (unlock.unlockedAt.getTime() < existing.unlockedAt.getTime()) {
      existing.unlockedAt = unlock.unlockedAt;
      existing.sessionId = unlock.sessionId;
      existing.iterationId = unlock.iterationId;
    }
  }

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
      unlockedAt: merged?.unlockedAt ?? null,
      dateReliable: merged?.dateReliable ?? true,
      sources: merged?.sources ?? [],
      sessionId: merged?.sessionId ?? null,
      iterationId: merged?.iterationId ?? null,
    };
  });

  return { ...empty, entries };
};
