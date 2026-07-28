import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEvent, UpdateStateEventPatch } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { stateEventsTable } from '../../schema';
import { updateOrFetch } from '../updateOrFetch';

// Corrección de un evento del historial: fecha, nota y — solo desde la
// corrección de playthrough del Edit modal (saveExistingIteration) — el
// TIPO (Beaten → Dropped y compañía). SPEC 4.5 sigue mandando para los
// cambios REALES de estado (se apilan desde Status, nunca se reescriben),
// pero un desenlace apuntado mal no es un cambio de opinión, es una errata
// — el mismo criterio que siempre aplicó a las fechas.
export const updateStateEvent = async (
  id: number,
  patch: UpdateStateEventPatch,
): Promise<StateEvent | null> => {
  const db = getDb();

  return updateOrFetch(
    patch,
    async () => {
      const [event] = await db
        .select(stateEventColumns)
        .from(stateEventsTable)
        .where(eq(stateEventsTable.id, id))
        .limit(1);
      return event ?? null;
    },
    async () => {
      const [updated] = await db
        .update(stateEventsTable)
        .set(patch)
        .where(eq(stateEventsTable.id, id))
        .returning(stateEventColumns);
      return updated ?? null;
    },
  );
};
