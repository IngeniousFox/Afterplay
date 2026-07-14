import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable } from '../../schema';

// Borrar la iteración arrastra sus sessions y state_events vía ON DELETE
// CASCADE. No hace falta lógica aparte para "el juego hereda el estado del
// siguiente más reciente" (SPEC 4.5): getGameById deriva currentState del
// último stateEvent que quede entre las iteraciones restantes, así que
// desaparece solo en cuanto se borran los suyos.
export const deleteIteration = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(iterationsTable)
    .where(eq(iterationsTable.id, id))
    .returning({ id: iterationsTable.id });
  return deleted.length > 0;
};
