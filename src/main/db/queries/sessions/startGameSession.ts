import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { iterationsTable, sessionsTable } from '../../schema';
import { resolveIterationForPlay } from './resolveIterationForPlay';

// "Empezar a jugar" un juego desde el main (lo usan el watcher al detectar un
// arranque y el botón Play). Equivale a pulsar Play: garantiza que haya un
// playthrough activo —creando uno nuevo o reanudando un on_hold/resting,
// misma regla que ActionBar/StatusCard, ver resolveIterationForPlay— y
// cuelga de él una sesión trackeada abierta.
//
// Devuelve null si el juego ya tenía una sesión abierta (Play manual o una
// detección previa): no se duplica.
export const startGameSession = async (gameId: number): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Dedup: ¿ya hay una sesión abierta en alguna iteración del juego?
    const [alreadyOpen] = await tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .where(and(eq(iterationsTable.gameId, gameId), isNull(sessionsTable.endedAt)))
      .limit(1);
    if (alreadyOpen) return null;

    const now = new Date();
    const { iterationId, needsStartAnchor } = await resolveIterationForPlay(tx, gameId, now);

    const [session] = await tx
      .insert(sessionsTable)
      .values({
        iterationId,
        isManual: false,
        startedAt: now,
        endedAt: null,
        durationSec: null,
        datePrecision: 'datetime',
        milestone: null,
      })
      .returning(sessionColumns);

    if (needsStartAnchor) {
      await tx
        .update(iterationsTable)
        .set({ startSessionId: session.id })
        .where(eq(iterationsTable.id, iterationId));
    }

    return session;
  });
};
