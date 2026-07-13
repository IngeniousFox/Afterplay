import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { stateEventsTable } from '../../schema';

export const getStateEventsByIteration = async (iterationId: number): Promise<StateEvent[]> => {
  const db = getDb();
  return db
    .select(stateEventColumns)
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iterationId))
    .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));
};
