import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionClosedEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable } from '../../schema';

// Los datos del aviso "acabas de cerrar X" — se arman aquí, en una sola
// consulta, y no en el renderer: quien detecta el cierre es el watcher (main),
// y el renderer puede estar oculto en la bandeja o directamente sin montar.
//
// El total de horas suma TODAS las sesiones del juego (sus playthroughs
// incluidos), que es lo que un humano entiende por "llevas 43h con esto" —
// no las de este playthrough suelto.
export const getSessionClosedInfo = async (
  sessionId: number,
): Promise<SessionClosedEvent | null> => {
  const db = getDb();

  const [session] = await db
    .select({
      id: sessionsTable.id,
      durationSec: sessionsTable.durationSec,
      // Desde la tabla JOINEADA y no sessions.iterationId: la columna de
      // sessions es nullable (emulador sin asignar) y este inner join ya
      // garantiza que aquí siempre hay playthrough — que el tipo lo diga.
      iterationId: iterationsTable.id,
      gameId: iterationsTable.gameId,
      gameTitle: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      endless: gamesTable.endless,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session) return null;

  const siblings = await db
    .select({ id: sessionsTable.id, durationSec: sessionsTable.durationSec })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(eq(iterationsTable.gameId, session.gameId));

  const durationSec = session.durationSec ?? 0;
  const totalSeconds = siblings.reduce((sum, row) => sum + (row.durationSec ?? 0), 0);
  // Estrictamente mayor que las demás: si empatas con una sesión anterior no
  // es un récord nuevo, y anunciarlo como tal sería ruido.
  const isLongest =
    durationSec > 0 &&
    siblings.every((row) => row.id === session.id || (row.durationSec ?? 0) < durationSec);

  return {
    sessionId: session.id,
    gameId: session.gameId,
    iterationId: session.iterationId,
    endless: session.endless,
    gameTitle: session.gameTitle,
    coverUrl: session.coverUrl,
    heroUrl: session.heroUrl,
    durationSec,
    totalHours: totalSeconds / 3600,
    isLongest,
  };
};
