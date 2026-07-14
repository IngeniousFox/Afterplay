import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SpendEvent } from '../../../../shared/types';
import { spendEventColumns } from '../../projections';
import { spendEventsTable } from '../../schema';

// Igual que updateStateEvent — solo la nota es editable desde el historial;
// cantidad/fecha/tipo se quedan como se registraron.
export const updateSpendEvent = async (
  id: number,
  note: string | null,
): Promise<SpendEvent | null> => {
  const db = getDb();
  const [updated] = await db
    .update(spendEventsTable)
    .set({ note })
    .where(eq(spendEventsTable.id, id))
    .returning(spendEventColumns);
  return updated ?? null;
};
