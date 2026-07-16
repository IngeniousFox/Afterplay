import { desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { PendingSession } from '../../../../shared/types';
import { emulatorsTable, sessionsTable } from '../../schema';

// EMULADORES.md §6 — sesiones de emulador sin asignar todavía (iterationId
// null): la bandeja "Pending" de la vista de Sesiones. Al no colgar de
// ninguna iteración, quedan automáticamente FUERA de getAllSessions/getGames/
// stats (todos hacen inner join con iterations) — la regla "no cuentan en
// ninguna estadística hasta asignarse" sale gratis del propio modelo.
export const getPendingSessions = async (): Promise<PendingSession[]> => {
  const db = getDb();

  return (
    db
      .select({
        id: sessionsTable.id,
        emulatorId: emulatorsTable.id,
        emulatorName: emulatorsTable.name,
        startedAt: sessionsTable.startedAt,
        endedAt: sessionsTable.endedAt,
        durationSec: sessionsTable.durationSec,
      })
      .from(sessionsTable)
      // El inner join ya garantiza emulatorId no nulo — solo falta "sin asignar".
      .innerJoin(emulatorsTable, eq(sessionsTable.emulatorId, emulatorsTable.id))
      .where(isNull(sessionsTable.iterationId))
      .orderBy(desc(sessionsTable.startedAt))
  );
};
