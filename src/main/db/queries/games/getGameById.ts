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

  const iterations = await db
    .select()
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, id))
    .orderBy(asc(iterationsTable.id));
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

  // Reparto de gasto entre playthroughs — spendEvents no llevan iterationId
  // (SPEC 4, el gasto es del juego, no de un playthrough concreto), así que
  // se infiere por fecha: cada gasto cae en el primer playthrough que
  // seguía "abierto" (sin terminar en completed/dropped) en su fecha. Un
  // playthrough ya terminado no puede reclamar gasto posterior a su cierre
  // — eso pasa al siguiente playthrough (o al último si no hay más). Un
  // gasto muy anterior al primer playthrough (el juego comprado semanas
  // antes de arrancarlo) cae en ese primer playthrough. on_hold/resting no
  // cierran la ventana (mismo criterio que crear una iteración nueva al
  // volver a "Playing", ver StatusCard.tsx/ActionBar.tsx).
  const terminalAtByIteration = new Map<number, Date | null>();
  for (const iteration of iterations) {
    const events = stateEventsByIteration.get(iteration.id) ?? [];
    const latest = events[events.length - 1];
    terminalAtByIteration.set(
      iteration.id,
      latest && (latest.type === 'completed' || latest.type === 'dropped')
        ? latest.occurredAt
        : null,
    );
  }

  const spendByIteration = new Map<number, number>();
  for (const spend of spendEvents) {
    let chosen = iterations[0];
    for (const iteration of iterations) {
      chosen = iteration;
      const terminalAt = terminalAtByIteration.get(iteration.id) ?? null;
      if (terminalAt === null || spend.occurredAt < terminalAt) break;
    }
    if (chosen) {
      spendByIteration.set(chosen.id, (spendByIteration.get(chosen.id) ?? 0) + spend.amount);
    }
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
      spend: spendByIteration.get(iteration.id) ?? 0,
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
