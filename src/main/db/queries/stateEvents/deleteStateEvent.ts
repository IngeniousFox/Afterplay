import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { stateEventsTable } from '../../schema';

// Borrado real de un evento del log — SOLO lo usa la corrección de
// playthrough del Edit modal (Beaten/Dropped → "en realidad sigo jugando"):
// ese desenlace nunca ocurrió, y conservarlo sería exactamente el error a
// corregir. On Hold no pasa por aquí (no es un desenlace: volver a Playing
// desde una pausa es retomar, y la pausa se queda). Fuera de esa corrección
// el log sigue siendo append-only (SPEC 4.5): los cambios de estado reales
// se apilan desde Status, nunca se borran.
export const deleteStateEvent = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(stateEventsTable)
    .where(eq(stateEventsTable.id, id))
    .returning({ id: stateEventsTable.id });
  return deleted.length > 0;
};
