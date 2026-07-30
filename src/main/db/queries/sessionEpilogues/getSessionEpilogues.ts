import { eq, inArray, type SQL } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionEpilogueSummary } from '../../../../shared/types';
import { buildSessionMoments } from '../../../../shared/memory/moments';
import { sessionEpilogueColumns } from '../../projections';
import { gamesTable, iterationsTable, sessionEpiloguesTable, sessionsTable } from '../../schema';

const loadSessionEpilogues = async (condition: SQL): Promise<SessionEpilogueSummary[]> => {
  const db = getDb();
  const rows = await db
    .select({
      ...sessionEpilogueColumns,
      gameId: gamesTable.id,
      gameTitle: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      endless: gamesTable.endless,
      iterationLabel: iterationsTable.label,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      note: sessionsTable.note,
    })
    .from(sessionEpiloguesTable)
    .innerJoin(sessionsTable, eq(sessionEpiloguesTable.sessionId, sessionsTable.id))
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(condition)
    .orderBy(sessionEpiloguesTable.createdAt);
  if (rows.length === 0) return [];

  const gameIds = [...new Set(rows.map((row) => row.gameId))];
  const iterationRows = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualHours: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable)
    .where(inArray(iterationsTable.gameId, gameIds));
  const gameIdByIteration = new Map(iterationRows.map((row) => [row.id, row.gameId]));
  const sessionRows =
    iterationRows.length === 0
      ? []
      : await db
          .select({
            id: sessionsTable.id,
            iterationId: sessionsTable.iterationId,
            startedAt: sessionsTable.startedAt,
            durationSec: sessionsTable.durationSec,
          })
          .from(sessionsTable)
          .where(
            inArray(
              sessionsTable.iterationId,
              iterationRows.map((row) => row.id),
            ),
          );

  const totalHoursByGame = new Map<number, number>();
  for (const iteration of iterationRows) {
    totalHoursByGame.set(
      iteration.gameId,
      (totalHoursByGame.get(iteration.gameId) ?? 0) + (iteration.manualHours ?? 0),
    );
  }

  const sessionsByGame = new Map<
    number,
    { id: number; iterationId: number | null; startedAt: Date; durationSec: number | null }[]
  >();
  for (const session of sessionRows) {
    if (session.iterationId === null) continue;
    const gameId = gameIdByIteration.get(session.iterationId);
    if (gameId === undefined) continue;
    const durationSec = session.durationSec ?? 0;
    totalHoursByGame.set(gameId, (totalHoursByGame.get(gameId) ?? 0) + durationSec / 3600);
    const siblings = sessionsByGame.get(gameId) ?? [];
    siblings.push({
      id: session.id,
      iterationId: session.iterationId,
      startedAt: session.startedAt,
      durationSec: session.durationSec,
    });
    sessionsByGame.set(gameId, siblings);
  }

  return rows.map((row) => {
    const durationSec = row.durationSec ?? 0;
    const siblings = sessionsByGame.get(row.gameId) ?? [];
    const totalHours = totalHoursByGame.get(row.gameId) ?? 0;
    const current = siblings.find((session) => session.id === row.sessionId) ?? {
      id: row.sessionId,
      iterationId: null,
      startedAt: row.startedAt,
      durationSec,
    };
    return {
      ...row,
      endedAt: row.endedAt ?? row.startedAt,
      durationSec,
      totalHours,
      isLongest:
        durationSec > 0 &&
        siblings.every(
          (session) =>
            session.id === row.sessionId || (session.durationSec ?? 0) < durationSec,
        ),
      moments: buildSessionMoments({
        gameId: row.gameId,
        current,
        sessions: siblings,
        totalHours,
      }).slice(0, 3),
    };
  });
};

export const getPendingSessionEpilogues = (): Promise<SessionEpilogueSummary[]> =>
  loadSessionEpilogues(eq(sessionEpiloguesTable.status, 'pending'));

export const getSessionEpilogueById = async (id: number): Promise<SessionEpilogueSummary | null> =>
  (await loadSessionEpilogues(eq(sessionEpiloguesTable.id, id)))[0] ?? null;
