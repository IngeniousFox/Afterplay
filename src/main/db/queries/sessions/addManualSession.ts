import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { AddManualSessionInput, Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { iterationsTable, sessionsTable } from '../../schema';

// Solo sesiones manuales (registrar el pasado): el watcher del Bloque 3
// escribirá las suyas directo en el main sin pasar por IPC, así que aquí
// isManual va forzado a true y no se acepta desde fuera.
export const addManualSession = async (input: AddManualSessionInput): Promise<Session> => {
  const db = getDb();
  const { anchorAs, ...sessionValues } = input;

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(sessionsTable)
      .values({ ...sessionValues, isManual: true })
      .returning(sessionColumns);

    // Las sesiones de borde marcan el inicio/fin del playthrough (SPEC 4:
    // las fechas de una iteración se derivan de sus sesiones ancladas).
    // Se ancla en la misma transacción para que no quede a medias si algo
    // falla entre las dos escrituras.
    if (anchorAs === 'start') {
      await tx
        .update(iterationsTable)
        .set({ startSessionId: session.id })
        .where(eq(iterationsTable.id, session.iterationId));
    } else if (anchorAs === 'end') {
      await tx
        .update(iterationsTable)
        .set({ endSessionId: session.id })
        .where(eq(iterationsTable.id, session.iterationId));
    }

    return session;
  });
};
