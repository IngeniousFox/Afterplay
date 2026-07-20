import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// Borrar una sesión CERRADA. Una abierta no se borra: el watcher la está
// siguiendo (se pararía sola y la reabriría al ciclo siguiente con el juego
// corriendo — el botón Stop existe para eso). Modelo v2: las sesiones son
// filas independientes (nada las referencia — las fechas de los playthroughs
// se derivan del log de estados), así que borrar es borrar, sin re-anclajes.
// Horas, contadores y fechas derivadas se recalculan solos al leer; el
// historial de estados no se toca — un 'started' que nació con esa sesión
// sigue siendo verdad histórica.
export const deleteSession = async (id: number): Promise<boolean> => {
  const db = getDb();

  const [session] = await db
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  if (!session) return false;
  if (session.endedAt === null) {
    throw new Error('La sesión sigue abierta — párala antes de borrarla');
  }

  const deleted = await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .returning({ id: sessionsTable.id });
  return deleted.length > 0;
};
