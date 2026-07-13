import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { gamesTable } from '../../schema';

// Borrar el juego arrastra todo lo suyo vía ON DELETE CASCADE: iterations
// (y de rebote sus sessions y state_events) y spend_events. Devuelve false
// si el id no existía.
export const deleteGame = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(gamesTable)
    .where(eq(gamesTable.id, id))
    .returning({ id: gamesTable.id });
  return deleted.length > 0;
};
