import { getDb } from '../..';
import type { SpendEventSummary } from '../../../../shared/types';
import { spendEventsTable } from '../../schema';

// Todos los gastos de la biblioteca, sin filtrar por juego — para las
// métricas globales de Stats (Bloque 5B: Total Spent / Avg Cost per Hour,
// con o sin filtro de año).
export const getAllSpendEvents = async (): Promise<SpendEventSummary[]> => {
  const db = getDb();
  return db
    .select({ amount: spendEventsTable.amount, occurredAt: spendEventsTable.occurredAt })
    .from(spendEventsTable);
};
