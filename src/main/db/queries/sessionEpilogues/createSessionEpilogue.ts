import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionEpilogue, SessionFinalized } from '../../../../shared/types';
import { sessionEpilogueColumns } from '../../projections';
import { sessionEpiloguesTable } from '../../schema';

export const createSessionEpilogue = async (
  finalization: SessionFinalized,
): Promise<SessionEpilogue> => {
  const db = getDb();
  const [created] = await db
    .insert(sessionEpiloguesTable)
    .values({
      sessionId: finalization.sessionId,
      closeReason: finalization.reason,
    })
    .onConflictDoNothing({ target: sessionEpiloguesTable.sessionId })
    .returning(sessionEpilogueColumns);
  if (created) return created;

  const [existing] = await db
    .select(sessionEpilogueColumns)
    .from(sessionEpiloguesTable)
    .where(eq(sessionEpiloguesTable.sessionId, finalization.sessionId))
    .limit(1);
  if (!existing) {
    throw new Error(`No se pudo crear el epílogo de la sesión ${finalization.sessionId}`);
  }
  return existing;
};
