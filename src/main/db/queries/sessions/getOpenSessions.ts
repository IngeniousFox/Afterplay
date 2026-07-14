import { eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable, sessionsTable } from '../../schema';

export type OpenSession = {
  sessionId: number;
  gameId: number;
  startedAt: Date;
  // Último latido del watcher mientras la sesión estaba viva. Es la mejor
  // estimación del fin real si la app murió de golpe (ver reconcile).
  lastHeartbeatAt: Date | null;
};

// Todas las sesiones abiertas (endedAt null) con el juego al que pertenecen.
// Las usa el watcher al arrancar para reconciliar: si el juego no está en
// marcha de verdad, esa sesión abierta ya no es válida (ver watcher).
export const getOpenSessions = async (): Promise<OpenSession[]> => {
  const db = getDb();

  return db
    .select({
      sessionId: sessionsTable.id,
      gameId: iterationsTable.gameId,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(isNull(sessionsTable.endedAt));
};
