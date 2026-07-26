import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable } from '../../schema';

// De qué juego es una iteración. Existe por el cierre de sesiones de
// emulador en el watcher: su clave de vigilancia es "emu:N" (el emulador no
// sabe de juegos), así que cuando la sesión ya fue ASIGNADA a un juego
// emulado, el gameId hay que ir a buscarlo — y es lo que decide si al cerrar
// toca backup de partidas o no.
export const getIterationGameId = async (iterationId: number): Promise<number | null> => {
  const db = getDb();
  const [row] = await db
    .select({ gameId: iterationsTable.gameId })
    .from(iterationsTable)
    .where(eq(iterationsTable.id, iterationId))
    .limit(1);
  return row?.gameId ?? null;
};
