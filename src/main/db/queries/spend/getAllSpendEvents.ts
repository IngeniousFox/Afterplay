import { getDb } from '../..';
import type { SpendEventSummary } from '../../../../shared/types';
import { spendEventsTable } from '../../schema';

// Todos los gastos de la biblioteca, sin filtrar por juego — para las
// métricas globales de Stats (Bloque 5B: Total Spent / Avg Cost per Hour,
// con o sin filtro de año).
//
// El gameId no lo usa Stats (sus métricas son sumas globales), pero sí el
// modo ambiente, que necesita saber cuánto costó UN juego concreto para
// poder decir su coste por hora. Sale gratis: ya estamos leyendo la tabla.
export const getAllSpendEvents = async (): Promise<SpendEventSummary[]> => {
  const db = getDb();
  return db
    .select({
      gameId: spendEventsTable.gameId,
      amount: spendEventsTable.amount,
      occurredAt: spendEventsTable.occurredAt,
    })
    .from(spendEventsTable);
};
