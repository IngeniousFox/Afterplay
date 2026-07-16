import { eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable, sessionsTable } from '../../schema';

export type OpenSession = {
  sessionId: number;
  // Exactamente uno de los dos viene puesto: gameId para sesiones normales
  // (resuelto vía su iteración), emulatorId para sesiones de emulador sin
  // asignar (iterationId null — por eso el join es LEFT, un inner las
  // dejaría invisibles para el watcher y sus cierres no se detectarían).
  gameId: number | null;
  emulatorId: number | null;
  startedAt: Date;
  // Último latido del watcher mientras la sesión estaba viva. Es la mejor
  // estimación del fin real si la app murió de golpe (ver reconcile).
  lastHeartbeatAt: Date | null;
};

// Todas las sesiones abiertas (endedAt null) con su dueño (juego o
// emulador). Las usa el watcher al arrancar para reconciliar y en cada
// ciclo para adoptar sesiones que él no abrió (botón Play).
export const getOpenSessions = async (): Promise<OpenSession[]> => {
  const db = getDb();

  return db
    .select({
      sessionId: sessionsTable.id,
      gameId: iterationsTable.gameId,
      emulatorId: sessionsTable.emulatorId,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .leftJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(isNull(sessionsTable.endedAt));
};
