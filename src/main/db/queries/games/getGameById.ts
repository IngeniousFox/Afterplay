import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameDetail, IterationDetail } from '../../../../shared/types';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../schema';

export const getGameById = async (id: number): Promise<GameDetail | null> => {
  const db = getDb();

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, id)).limit(1);
  if (!game) return null;

  const iterations = await db.select().from(iterationsTable).where(eq(iterationsTable.gameId, id));
  const iterationIds = iterations.map((iteration) => iteration.id);

  // Si el juego no tiene iteraciones todavía (comprado pero sin tocar, como
  // Hollow Knight en el seed), no hay nada que buscar en sessions/stateEvents
  // evito el inArray con array vacío, que en SQL sería un "IN ()" inválido.
  const sessions = iterationIds.length
    ? await db.select().from(sessionsTable).where(inArray(sessionsTable.iterationId, iterationIds))
    : [];

  const stateEvents = iterationIds.length
    ? await db
        .select()
        .from(stateEventsTable)
        .where(inArray(stateEventsTable.iterationId, iterationIds))
        .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id))
    : [];

  const spendEvents = await db
    .select()
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, id))
    .orderBy(asc(spendEventsTable.occurredAt), asc(spendEventsTable.id));

  // Agrupo sessions y stateEvents por iterationId una sola vez, en vez de
  // filtrar el array entero por cada iteración dentro del map de abajo.
  const sessionsByIteration = new Map<number, typeof sessions>();
  for (const session of sessions) {
    const list = sessionsByIteration.get(session.iterationId) ?? [];
    list.push(session);
    sessionsByIteration.set(session.iterationId, list);
  }

  const stateEventsByIteration = new Map<number, typeof stateEvents>();
  for (const event of stateEvents) {
    const list = stateEventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    stateEventsByIteration.set(event.iterationId, list);
  }

  const iterationDetails: IterationDetail[] = iterations.map((iteration) => {
    const iterationSessions = sessionsByIteration.get(iteration.id) ?? [];
    const trackedSeconds = iterationSessions.reduce(
      (sum, session) => sum + (session.durationSec ?? 0),
      0,
    );

    const hours = iteration.manualTotalPlayed ?? trackedSeconds / 3600;

    const startSession = iterationSessions.find(
      (session) => session.id === iteration.startSessionId,
    );
    const endSession = iterationSessions.find((session) => session.id === iteration.endSessionId);

    const iterationStateEvents = stateEventsByIteration.get(iteration.id) ?? [];
    const latestEvent = iterationStateEvents[iterationStateEvents.length - 1];

    return {
      ...iteration,
      hours,
      startedAt: startSession?.startedAt ?? null,
      endedAt: endSession ? (endSession.endedAt ?? endSession.startedAt) : null,
      currentState: latestEvent?.type ?? null,
      sessions: iterationSessions,
    };
  });

  const totalHours = iterationDetails.reduce((sum, iteration) => sum + iteration.hours, 0);
  const totalSpend = spendEvents.reduce((sum, spend) => sum + spend.amount, 0);

  const costPerHour = totalHours > 0 ? totalSpend / totalHours : null;

  const isLive = sessions.some((session) => session.endedAt === null);
  const latestStateEvent = stateEvents[stateEvents.length - 1];

  return {
    ...game,
    totalHours,
    currentState: latestStateEvent?.type ?? null,
    isLive,
    totalSpend,
    costPerHour,
    stateHistory: stateEvents,
    spendHistory: spendEvents,
    iterations: iterationDetails,
  };
};
