import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { spendEventsTable } from '../../schema';

// Borrado real, no anulación — a este tamaño de app no hace falta el
// historial de "gasto borrado" que sí tiene sentido en algo append-only más
// serio (stateEvents, que si son correcciones de verdad).
export const deleteSpendEvent = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(spendEventsTable)
    .where(eq(spendEventsTable.id, id))
    .returning({ id: spendEventsTable.id });
  return deleted.length > 0;
};
