import { eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../..';
import type {
  ChapterStateEvent,
  ChapterUnlock,
  ManualBlock,
} from '../../../../shared/memory/chapters';
import type { MemorySession } from '../../../../shared/memory/moments';
import { manualHoursAnchor } from '../../../../shared/playthroughState';
import {
  achievementsTable,
  achievementUnlocksTable,
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../schema';

// La materia prima de los capítulos del Loop (shared/memory) leída de la DB
// en una pasada: sesiones con su juego resuelto, eventos de estado, títulos,
// y las horas manuales de cada playthrough con su ancla de calendario.
//
// Los inner join con iterations hacen el filtrado importante solos: una
// sesión de emulador sin asignar (iterationId null) no pertenece a ningún
// juego y se cae del join — la regla "no cuenta en ningún capítulo"
// (AFTERPLAY-LOOP.md §7.4) sale del modelo, no de un WHERE que recordar.

export type MemoryFacts = {
  sessions: MemorySession[];
  events: ChapterStateEvent[];
  titlesByGame: Map<number, string>;
  // Un bloque por playthrough con horas manuales, anclado con la MISMA regla
  // que Stats y el Journey (manualHoursAnchor: el fin si lo hay, si no el
  // inicio) — los capítulos deben contar lo mismo que las pantallas que
  // tienen al lado.
  manualBlocks: ManualBlock[];
  // Suma por juego de esos bloques — la línea base de los hitos de horas de
  // deriveMoments (ahí no importa el ancla, solo cuánto había ya jugado).
  manualHoursByGame: Map<number, number>;
  // Los desbloqueos de logros con fecha FIABLE, ya fundidos por logro entre
  // fuentes (LOGROS-IDEAS.md §2.3) — la materia del bloque de logros de cada
  // capítulo. Los de fecha no fiable ni salen de aquí: una fecha de rescate
  // no puede fabricar historia en ningún mes.
  unlocks: ChapterUnlock[];
};

export const getMemoryFacts = async (): Promise<MemoryFacts> => {
  const db = getDb();

  const sessions = await db
    .select({
      id: sessionsTable.id,
      gameId: iterationsTable.gameId,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      isManual: sessionsTable.isManual,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id));

  const eventRows = await db
    .select({
      iterationId: stateEventsTable.iterationId,
      gameId: iterationsTable.gameId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  const games = await db.select({ id: gamesTable.id, title: gamesTable.title }).from(gamesTable);

  const manualRows = await db
    .select({
      iterationId: iterationsTable.id,
      gameId: iterationsTable.gameId,
      hours: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable)
    .where(isNotNull(iterationsTable.manualTotalPlayed));

  const titlesByGame = new Map(games.map((game) => [game.id, game.title]));

  // Eventos agrupados por playthrough, para calcular el ancla de cada bloque
  // manual sin volver a la DB.
  const eventsByIteration = new Map<number, typeof eventRows>();
  for (const event of eventRows) {
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  const manualBlocks: ManualBlock[] = [];
  const manualHoursByGame = new Map<number, number>();
  for (const row of manualRows) {
    const hours = row.hours ?? 0;
    if (hours <= 0) continue;
    manualBlocks.push({
      gameId: row.gameId,
      hours,
      anchor: manualHoursAnchor(eventsByIteration.get(row.iterationId) ?? []),
    });
    manualHoursByGame.set(row.gameId, (manualHoursByGame.get(row.gameId) ?? 0) + hours);
  }

  // Desbloqueos con su definición, para fundirlos por logro con la MISMA
  // regla que getGameAchievements: fecha fiable gana; empatadas, la más
  // temprana. Al capítulo solo viajan los que quedan con fecha fiable.
  const unlockRows = await db
    .select({
      achievementId: achievementUnlocksTable.achievementId,
      gameId: achievementsTable.gameId,
      name: achievementsTable.displayName,
      description: achievementsTable.description,
      globalPercent: achievementsTable.globalPercent,
      unlockedAt: achievementUnlocksTable.unlockedAt,
      dateReliable: achievementUnlocksTable.dateReliable,
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id));

  const mergedUnlocks = new Map<number, (typeof unlockRows)[number]>();
  for (const row of unlockRows) {
    const existing = mergedUnlocks.get(row.achievementId);
    if (!existing) {
      mergedUnlocks.set(row.achievementId, row);
      continue;
    }
    if (row.dateReliable && !existing.dateReliable) {
      mergedUnlocks.set(row.achievementId, row);
      continue;
    }
    if (!row.dateReliable && existing.dateReliable) continue;
    if (row.unlockedAt.getTime() < existing.unlockedAt.getTime()) {
      mergedUnlocks.set(row.achievementId, row);
    }
  }
  const unlocks: ChapterUnlock[] = [...mergedUnlocks.values()]
    .filter((row) => row.dateReliable)
    .map((row) => ({
      gameId: row.gameId,
      name: row.name,
      description: row.description,
      globalPercent: row.globalPercent,
      unlockedAt: row.unlockedAt,
    }));

  return { sessions, events: eventRows, titlesByGame, manualBlocks, manualHoursByGame, unlocks };
};
