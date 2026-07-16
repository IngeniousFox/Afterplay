import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// EMULADORES.md §4 — el watcher detectó un emulador en marcha: se registra
// la sesión SIN saber a qué juego pertenece (iterationId null, emulatorId
// puesto). Vive en la bandeja "Pending" hasta que el usuario la asigne.
//
// Mismo espíritu de dedup que startGameSession: si este emulador ya tiene
// una sesión abierta (detección previa, o quedó de un arranque anterior),
// no se duplica — devuelve null y el watcher la adopta.
export const createEmulatorSession = async (emulatorId: number): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [alreadyOpen] = await tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.emulatorId, emulatorId), isNull(sessionsTable.endedAt)))
      .limit(1);
    if (alreadyOpen) return null;

    const [session] = await tx
      .insert(sessionsTable)
      .values({
        iterationId: null,
        emulatorId,
        isManual: false,
        startedAt: new Date(),
        endedAt: null,
        durationSec: null,
        datePrecision: 'datetime',
        milestone: null,
      })
      .returning(sessionColumns);

    return session;
  });
};
