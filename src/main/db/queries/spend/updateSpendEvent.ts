import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SpendEvent, UpdateSpendEventPatch } from '../../../../shared/types';
import { spendEventColumns } from '../../projections';
import { spendEventsTable } from '../../schema';

// Corrección de un gasto desde el historial: cantidad, fecha y nota — una
// errata al teclear no es historia que preservar. El TIPO (purchase/
// ingame_spend) sí se queda como se registró: cambiarlo de verdad es borrar
// la entrada y crearla bien.
export const updateSpendEvent = async (
  id: number,
  patch: UpdateSpendEventPatch,
): Promise<SpendEvent | null> => {
  const db = getDb();

  // Drizzle peta con un .set() vacío (mismo caso que updateGame.ts).
  if (Object.keys(patch).length === 0) {
    const [event] = await db
      .select(spendEventColumns)
      .from(spendEventsTable)
      .where(eq(spendEventsTable.id, id))
      .limit(1);
    return event ?? null;
  }

  const [updated] = await db
    .update(spendEventsTable)
    .set(patch)
    .where(eq(spendEventsTable.id, id))
    .returning(spendEventColumns);
  return updated ?? null;
};
