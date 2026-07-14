import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { stateEventsTable } from '../../schema';

// Solo la nota es editable — el tipo/fecha del hito nunca se toca (SPEC 4.5:
// corregir un ESTADO es añadir un evento nuevo, no reescribir el pasado).
// Corregir un typo en la nota no es lo mismo que corregir el estado, así
// que esto sí es una actualización real, no un evento nuevo.
export const updateStateEvent = async (
  id: number,
  note: string | null,
): Promise<StateEvent | null> => {
  const db = getDb();
  const [updated] = await db
    .update(stateEventsTable)
    .set({ note })
    .where(eq(stateEventsTable.id, id))
    .returning(stateEventColumns);
  return updated ?? null;
};
