import { desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionWithGame } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable } from '../../schema';

// Todas las sesiones "de verdad" de la biblioteca, con el juego ya resuelto
// (Bloque 5A: vista de Sesiones, todas o filtradas por juego) — más reciente
// primero. Las de milestone no nulo son marcadores de borde de una iteración
// (arrancan y acaban en el mismo instante, duración 0 — ver
// createGameWithDetails.ts/StatusCard.tsx): no son sesiones que nadie jugó,
// así que no pintan aquí.
export const getAllSessions = async (): Promise<SessionWithGame[]> => {
  const db = getDb();
  return db
    .select({
      id: sessionsTable.id,
      iterationId: sessionsTable.iterationId,
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
    .where(isNull(sessionsTable.milestone))
    .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id));
};
