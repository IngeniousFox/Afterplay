import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { deriveMoments } from '../../../../shared/memory/moments';
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
    .select({
      id: sessionsTable.id,
      gameId: iterationsTable.gameId,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      isManual: sessionsTable.isManual,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(eq(iterationsTable.gameId, session.gameId));

  const durationSec = session.durationSec ?? 0;
  const totalSeconds = siblings.reduce((sum, row) => sum + (row.durationSec ?? 0), 0);
  // El récord lo decide deriveMoments y no una regla propia: es la MISMA lib
  // pura que pinta el distintivo Flame del diario y alimenta los recaps del
  // Loop. Aquí se contaba récord sin mínimo de sesiones previas y midiendo
  // contra TODAS las filas del juego —las manuales incluidas, que son horas
  // tecleadas y no partidas—, así que el toast celebraba en caliente ("Your
  // longest session with this game") un récord que el diario no reconocía
  // después: la segunda partida de cualquier juego batía "récord", y un juego
  // con una fila manual vieja de 6h no lo batía nunca. Toast y diario ya dicen
  // lo mismo porque salen del mismo sitio (moments.ts: solo sesiones medidas,
  // mínimo de LONGEST_MIN_PRIOR_SESSIONS previas y récord estricto).
  //
  // Pero la regla sigue escrita en TRES sitios, no en dos: el HUD del overlay
  // decide su "Longest" en vivo con la suya (`longestPreviousSec >= 600 &&
  // elapsed > longestPreviousSec`, OverlayHud.tsx), sin mínimo de sesiones y
  // sin excluir manuales. O sea que el HUD puede celebrar en caliente un
  // récord que este toast no repite al cerrar. Ese fichero es de otra zona y
  // mientras no adopte deriveMoments la incoherencia sigue viva.
  const isLongest = deriveMoments(siblings).some(
    (moment) => moment.type === 'longest_session' && moment.sessionId === session.id,
  );

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
