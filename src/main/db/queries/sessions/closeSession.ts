import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// Cierra la sesión abierta que crea el botón Play del detalle (SPEC 10.7) —
// Play/Stop es tracking manual mientras no exista el watcher del Bloque 3.
export const closeSession = async (id: number, endedAt: Date): Promise<Session | null> => {
  const db = getDb();

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1);
  if (!session) return null;

  const durationSec = Math.max(
    0,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000),
  );

  const [updated] = await db
    .update(sessionsTable)
    .set({ endedAt, durationSec })
    .where(eq(sessionsTable.id, id))
    .returning(sessionColumns);
  return updated ?? null;
};
