import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { gamesTable, sessionsTable } from '../../schema';
import { resolveIterationForPlay } from './resolveIterationForPlay';

// EMULADORES.md §6 — asignar una sesión pendiente (de emulador, sin
// iterationId) a un juego de la biblioteca. Reutiliza EXACTAMENTE la misma
// regla de "¿a qué playthrough cae?" que el watcher/Play
// (resolveIterationForPlay), con la fecha REAL de la sesión: si el juego no
// estaba activo, el evento 'started' que lo activa nace en el momento en que
// de verdad se jugó, no en el momento de asignarla.
export const assignSession = async (sessionId: number, gameId: number): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select(sessionColumns)
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);
    if (!session) return null;
    if (session.iterationId !== null) {
      throw new Error(`La sesión ${sessionId} ya está asignada`);
    }

    const [game] = await tx
      .select({ id: gamesTable.id, isEmulated: gamesTable.isEmulated })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);
    if (!game) throw new Error(`No existe el juego ${gameId}`);
    // Regla 3 de EMULADORES.md §6 — el backend también la impone, no solo el
    // filtro del modal: una sesión de emulador solo puede caer en un juego
    // emulado (evita asignaciones sin sentido por error).
    if (!game.isEmulated) {
      throw new Error(`El juego ${gameId} no está marcado como emulado`);
    }

    const { iterationId } = await resolveIterationForPlay(tx, gameId, session.startedAt);

    // emulatorId se conserva a propósito: queda como registro de qué
    // emulador generó la sesión (EMULADORES.md §5).
    const [updated] = await tx
      .update(sessionsTable)
      .set({ iterationId })
      .where(eq(sessionsTable.id, sessionId))
      .returning(sessionColumns);

    return updated ?? null;
  });
};
