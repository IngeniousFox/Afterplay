import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// Diario de sesión: "dónde lo dejé". Se escribe desde el aviso de cierre
// (mientras lo tienes fresco) o después, desde la propia fila de la sesión —
// las dos vías acaban aquí.
//
// Vacío se guarda como null, no como cadena vacía: "sin nota" es un estado,
// no un texto de longitud cero, y así el resto de la app solo tiene que
// comprobar null.
export const updateSessionNote = async (id: number, note: string): Promise<Session | null> => {
  const db = getDb();
  const [updated] = await db
    .update(sessionsTable)
    .set({ note: note.trim() || null })
    .where(eq(sessionsTable.id, id))
    .returning(sessionColumns);
  return updated ?? null;
};
