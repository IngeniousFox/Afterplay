import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// Borrar una sesión CERRADA. Una abierta no se borra, y el motivo NO es que
// el watcher la reabra —no lo hace—: la clave del juego sigue viva en su mapa
// en memoria (`this.active`, watcher.ts), así que el ciclo siguiente no la ve
// como untracked y no abre nada. Lo que pasa es peor: el watcher se queda
// siguiendo un id que ya no existe, los latidos escriben en el vacío (UPDATE
// sin filas) y al morir el proceso el cierre —closeSessionIfOpen, watcher.ts—
// devuelve null: se pierde el resto de la partida entera y ni siquiera salta
// el aviso de cierre, que cuelga de ese mismo valor de retorno. Por eso
// primero se para (botón Stop) y luego se borra. Modelo v2: las sesiones son
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
