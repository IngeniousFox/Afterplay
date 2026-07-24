import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEvent, UpdateStateEventPatch } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { stateEventsTable } from '../../schema';
import { updateOrFetch } from '../updateOrFetch';

// Corrección de un evento del historial: fecha y nota. El TIPO nunca se
// toca (SPEC 4.5: corregir un ESTADO es añadir un evento nuevo, no
// reescribir el pasado) — pero una fecha elegida mal en un picker no es un
// cambio de opinión, es una errata, y eso sí se corrige sobre la entrada.
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
