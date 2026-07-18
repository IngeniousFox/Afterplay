import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEventSummary } from '../../../../shared/types';
import { iterationsTable, stateEventsTable } from '../../schema';

// Todos los cambios de estado de la biblioteca, con el juego ya resuelto —
// para el desglose "Status Changes" de Stats por año (Bloque 5D): cuenta
// transiciones (started/completed/dropped/on_hold) ocurridas en un año
// concreto, algo que useGames() no puede dar (solo trae el estado ACTUAL,
// no su historial). id/datePrecision/iterationLabel los pide la galería de
// completados de Stats (key estable + fecha con su precisión + qué
// playthrough se completó en el tooltip de cada carátula).
export const getAllStateEvents = async (): Promise<StateEventSummary[]> => {
  const db = getDb();
  return db
    .select({
      id: stateEventsTable.id,
      gameId: iterationsTable.gameId,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      datePrecision: stateEventsTable.datePrecision,
      iterationLabel: iterationsTable.label,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));
};
