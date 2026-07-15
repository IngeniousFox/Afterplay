import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEventSummary } from '../../../../shared/types';
import { iterationsTable, stateEventsTable } from '../../schema';

// Todos los cambios de estado de la biblioteca, con el juego ya resuelto —
// para el desglose "Status Changes" de Stats por año (Bloque 5D): cuenta
// transiciones (started/completed/dropped/on_hold) ocurridas en un año
// concreto, algo que useGames() no puede dar (solo trae el estado ACTUAL,
// no su historial).
export const getAllStateEvents = async (): Promise<StateEventSummary[]> => {
  const db = getDb();
  return db
    .select({
      gameId: iterationsTable.gameId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));
};
