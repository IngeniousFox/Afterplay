import { desc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionWithGame } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable } from '../../schema';

// Todas las sesiones de la biblioteca, con el juego ya resuelto (Bloque 5A:
// vista de Sesiones, todas o filtradas por juego) — más reciente primero.
// Modelo v2: TODA fila de sessions es tiempo jugado real, ya no existen los
// marcadores de borde que antes había que filtrar aquí.
export const getAllSessions = async (): Promise<SessionWithGame[]> => {
  const db = getDb();
  return db
    .select({
      id: sessionsTable.id,
      // iterationsTable.id y no sessionsTable.iterationId — mismo valor bajo
      // el inner join, pero el tipo sale number (no nullable).
      iterationId: iterationsTable.id,
      isManual: sessionsTable.isManual,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
      datePrecision: sessionsTable.datePrecision,
      gameId: iterationsTable.gameId,
      gameTitle: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id));
};
