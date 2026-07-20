import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionColumns } from '../../projections';
import { iterationsTable, sessionsTable } from '../../schema';

// Borrar una sesión REAL y CERRADA, con todas sus consecuencias resueltas en
// la misma transacción:
//
//   - Solo sesiones reales cerradas. Una sesión ABIERTA no se borra (el
//     watcher la está siguiendo — se pararía sola y la reabriría al ciclo
//     siguiente con el juego corriendo; el botón Stop existe para eso). Un
//     MARCADOR de borde (milestone puesto, duración 0) tampoco: es la
//     contabilidad de un playthrough manual y se gestiona desde Edit
//     (corregir fechas/desenlace, o Remove playthrough entero).
//
//   - Re-anclaje: la sesión puede ser el ancla de inicio de su playthrough
//     (startGameSession ancla la PRIMERA sesión real) o, en teoría, la de
//     fin. startSessionId/endSessionId no llevan ON DELETE — borrar sin más
//     dejaría la referencia colgando y el playthrough sin fecha. Se re-ancla
//     al mejor candidato restante de la misma iteración (inicio → la sesión
//     más temprana; fin → la más tardía), o null si no queda ninguna (el
//     próximo Play re-anclará solo, ver resolveIterationForPlay).
//
//   - El historial de ESTADOS no se toca a propósito: un 'started' que nació
//     con la primera sesión sigue siendo verdad histórica ("ese día pasó a
//     Playing") aunque borres la medición. Horas, contadores y fechas
//     derivadas se recalculan solos en las queries de lectura.
export const deleteSession = async (id: number): Promise<boolean> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select(sessionColumns)
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1);
    if (!session) return false;
    if (session.endedAt === null) {
      throw new Error('La sesión sigue abierta — párala antes de borrarla');
    }
    if (session.milestone !== null) {
      throw new Error('Los marcadores de playthrough se gestionan desde Edit, no se borran aquí');
    }

    if (session.iterationId !== null) {
      const [iteration] = await tx
        .select({
          id: iterationsTable.id,
          startSessionId: iterationsTable.startSessionId,
          endSessionId: iterationsTable.endSessionId,
        })
        .from(iterationsTable)
        .where(eq(iterationsTable.id, session.iterationId))
        .limit(1);

      if (iteration && iteration.startSessionId === id) {
        const [replacement] = await tx
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.iterationId, iteration.id), ne(sessionsTable.id, id)))
          .orderBy(asc(sessionsTable.startedAt), asc(sessionsTable.id))
          .limit(1);
        await tx
          .update(iterationsTable)
          .set({ startSessionId: replacement?.id ?? null })
          .where(eq(iterationsTable.id, iteration.id));
      }

      if (iteration && iteration.endSessionId === id) {
        const [replacement] = await tx
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.iterationId, iteration.id), ne(sessionsTable.id, id)))
          .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id))
          .limit(1);
        await tx
          .update(iterationsTable)
          .set({ endSessionId: replacement?.id ?? null })
          .where(eq(iterationsTable.id, iteration.id));
      }
    }

    const deleted = await tx
      .delete(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .returning({ id: sessionsTable.id });
    return deleted.length > 0;
  });
};
