import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { ResolveSessionEpilogueInput, SessionEpilogue } from '../../../../shared/types';
import { sessionEpilogueColumns } from '../../projections';
import { sessionEpiloguesTable } from '../../schema';

export const resolveSessionEpilogue = async ({
  id,
  status,
  tags,
  highlight,
}: ResolveSessionEpilogueInput): Promise<SessionEpilogue | null> => {
  const db = getDb();
  const [updated] = await db
    .update(sessionEpiloguesTable)
    .set({ status, tags, highlight, resolvedAt: new Date() })
    .where(eq(sessionEpiloguesTable.id, id))
    .returning(sessionEpilogueColumns);
  return updated ?? null;
};
