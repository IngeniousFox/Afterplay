import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionsTable } from '../../schema';

// Descartar una sesión de emulador sin asignar (abriste el emulador solo
// para configurarlo, no para jugar) — el guard `isNull(iterationId)` es a
// propósito: por esta vía SOLO se puede borrar una pendiente, nunca una ya
// asignada a un juego (eso sería tiempo jugado real, borrarlo es una
// decisión distinta que esta función no cubre).
export const deletePendingSession = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.iterationId)))
    .returning({ id: sessionsTable.id });
  return deleted.length > 0;
};
