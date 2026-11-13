import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import { deriveGameDetail } from '../../../../shared/domain/gameDetail';
import type { GameDetail, IterationDetail } from '../../../../shared/types';
import {
  gameColumns,
  iterationColumns,
  sessionColumns,
  spendEventColumns,
  stateEventColumns,
} from '../../projections';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../schema';
import { canMoveToPlanWhere } from './moveToPlan';

// La ficha completa de un juego. Las derivaciones —las fechas, el estado, las
// horas y el reparto del gasto que enseña la app (SPEC 4.4)— viven en
// src/shared/domain/gameDetail.ts (deriveGameDetail), compartidas con la ficha
// del móvil (AFTERPLAY-2.0.md §15.2, F-26). Aquí solo se traen las filas y se
// monta la respuesta.
//
// Y aquí NO se agrega en SQL como sí hace getGames con las sesiones, a
// propósito: esta consulta no se trae ni una fila que no acabe VIAJANDO al
// renderer — las sesiones son el Session History, los stateEvents el Journey
// y los spendEvents el historial de gasto. No hay nada que colapsar. Medido
// sobre la biblioteca real: 1,0 ms de media y 1,4 ms el peor de los 333 (el
// juego con 20 sesiones); con 95 sesiones en un solo juego, 2,7 ms. El coste
// crece con lo que la ficha ENSEÑA, que es lo justo.
export const getGameById = async (id: number): Promise<GameDetail | null> => {
  const db = getDb();

  const [game] = await db
    .select(gameColumns)
    .from(gamesTable)
    .where(eq(gamesTable.id, id))
    .limit(1);
  if (!game) return null;

  const iterations = await db
    .select(iterationColumns)
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, id))
    .orderBy(asc(iterationsTable.id));
  const iterationIds = iterations.map((iteration) => iteration.id);

  // Si el juego no tiene iteraciones todavía (añadido pero sin tocar), no
  // hay nada que buscar en sessions/stateEvents:
  // evito el inArray con array vacío, que en SQL sería un "IN ()" inválido.
  const sessions = iterationIds.length
    ? await db
        .select(sessionColumns)
        .from(sessionsTable)
        .where(inArray(sessionsTable.iterationId, iterationIds))
    : [];

  // El ORDER BY ya no lo necesita ninguna regla (deriveGameDetail no depende
  // del orden), pero se queda: stateHistory viaja así al renderer.
  const stateEvents = iterationIds.length
    ? await db
        .select(stateEventColumns)
        .from(stateEventsTable)
        .where(inArray(stateEventsTable.iterationId, iterationIds))
        .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id))
    : [];

  const spendEvents = await db
    .select(spendEventColumns)
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, id))
    .orderBy(asc(spendEventsTable.occurredAt), asc(spendEventsTable.id));

  // Sin `isRunning`: en el escritorio toda sesión abierta está en marcha,
  // porque el watcher barre las de cronómetro rancias en cada ciclo.
  const derived = deriveGameDetail({ iterations, sessions, stateEvents, spendEvents });

  const iterationDetails: IterationDetail[] = derived.iterations.map((entry) => ({
    ...entry.iteration,
    hours: entry.hours,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    startEvent: entry.startEvent,
    endEvent: entry.endEvent,
    startedBySession: entry.startedBySession,
    currentState: entry.currentState,
    sessions: entry.sessions,
    spend: entry.spend,
  }));

  const canMoveToPlan = game.planned
    ? false
    : (
        await db
          .select({ id: gamesTable.id })
          .from(gamesTable)
          .where(and(eq(gamesTable.id, id), canMoveToPlanWhere(id)))
          .limit(1)
      ).length > 0;

  return {
    ...game,
    totalHours: derived.totalHours,
    currentState: derived.currentState,
    isLive: derived.isLive,
    totalSpend: derived.totalSpend,
    costPerHour: derived.costPerHour,
    stateHistory: stateEvents,
    spendHistory: spendEvents,
    iterations: iterationDetails,
    canMoveToPlan,
  };
};
