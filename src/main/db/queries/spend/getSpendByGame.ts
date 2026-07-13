import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SpendEvent } from '../../../../shared/types';
import { spendEventColumns } from '../../projections';
import { spendEventsTable } from '../../schema';

export const getSpendByGame = async (gameId: number): Promise<SpendEvent[]> => {
  const db = getDb();
  return db
    .select(spendEventColumns)
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, gameId))
    .orderBy(asc(spendEventsTable.occurredAt), asc(spendEventsTable.id));
};
