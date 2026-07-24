import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SpendEvent, UpdateSpendEventPatch } from '../../../../shared/types';
import { spendEventColumns } from '../../projections';
import { spendEventsTable } from '../../schema';
import { updateOrFetch } from '../updateOrFetch';

// Corrección de un gasto desde el historial: cantidad, fecha y nota — una
// errata al teclear no es historia que preservar. El TIPO (purchase/
// ingame_spend) sí se queda como se registró: cambiarlo de verdad es borrar
// la entrada y crearla bien.
export const updateSpendEvent = async (
  id: number,
  patch: UpdateSpendEventPatch,
): Promise<SpendEvent | null> => {
  const db = getDb();

  return updateOrFetch(
    patch,
    async () => {
      const [event] = await db
        .select(spendEventColumns)
        .from(spendEventsTable)
        .where(eq(spendEventsTable.id, id))
        .limit(1);
      return event ?? null;
    },
    async () => {
      const [updated] = await db
        .update(spendEventsTable)
        .set(patch)
        .where(eq(spendEventsTable.id, id))
        .returning(spendEventColumns);
      return updated ?? null;
    },
  );
};
