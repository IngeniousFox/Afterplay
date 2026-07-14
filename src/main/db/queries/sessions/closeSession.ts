import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';

// Cierra una sesión abierta (botón Play del detalle, o el watcher del
// Bloque 3 al detectar que el proceso murió). Idempotente a propósito: si ya
// estaba cerrada, se devuelve tal cual sin recalcular nada. Sin esto, marcar
// un hito terminal (Beaten/Dropped) mientras el juego seguía en marcha cierra
// la sesión en ese instante (ver addStateEvent.ts) — cuando el watcher
// detecte el cierre real del proceso más tarde, volvería a llamar aquí sobre
// esa MISMA sesión ya cerrada, y sin esta guarda le pisaría la duración
// correcta con una inflada hasta ese momento posterior.
export const closeSession = async (id: number, endedAt: Date): Promise<Session | null> => {
  const db = getDb();

  const [session] = await db
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  if (!session) return null;
  if (session.endedAt !== null) return session;

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
