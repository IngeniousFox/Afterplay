import { getDb } from '../..';
import type { AddSpendEventInput, SpendEvent } from '../../../../shared/types';
import { spendEventColumns } from '../../projections';
import { spendEventsTable } from '../../schema';

// El gasto cuelga del JUEGO (gameId), no de la iteración — SPEC Nivel 1 bis.
// Por eso puede existir gasto sin haber jugado nunca (comprar antes de jugar).
export const addSpendEvent = async (input: AddSpendEventInput): Promise<SpendEvent> => {
  const db = getDb();
  const [spend] = await db.insert(spendEventsTable).values(input).returning(spendEventColumns);
  return spend;
};
