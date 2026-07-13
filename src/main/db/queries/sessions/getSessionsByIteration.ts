import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

export const getSessionsByIteration = async (iterationId: number): Promise<Session[]> => {
  const db = getDb();
  return db
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.iterationId, iterationId))
    .orderBy(asc(sessionsTable.startedAt), asc(sessionsTable.id));
};
