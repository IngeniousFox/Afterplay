import { and, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable, stateEventsTable } from '../../schema';

// Cambiar el DESENLACE de un playthrough manual (Beaten → Dropped, etc.)
// reescribiendo su marcador de fin y el stateEvent que nació con él — sin
// añadir un evento nuevo fechado hoy. Un playthrough registrado a mano es un
// dato tecleado, no un historial vivido dentro de la app: corregir "cómo
// terminó" es corregir una errata de ese registro (mismo criterio que
// updateMilestoneSession con las fechas), no un cambio de estado real que
// merezca su propia entrada. El evento conserva su fecha original.
//
// El match del stateEvent es el mismo de updateMilestoneSession (iteración +
// occurredAt idéntico al marcador + tipo idéntico al milestone viejo): se
// crearon juntos en la misma transacción, así que identifica al evento
// exacto aunque el playthrough tenga started y fin el mismo día.
export const updateMilestoneOutcome = async (
  id: number,
  milestone: 'completed' | 'dropped' | 'on_hold',
): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select(sessionColumns)
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1);
    if (!session) return null;
    if (session.milestone === null || session.milestone === 'started') {
      throw new Error(`La sesión ${id} no es un marcador de FIN manual — su desenlace no se edita`);
    }

    await tx
      .update(stateEventsTable)
      .set({ type: milestone })
      .where(
        and(
          eq(stateEventsTable.iterationId, session.iterationId),
          eq(stateEventsTable.occurredAt, session.startedAt),
          eq(stateEventsTable.type, session.milestone),
        ),
      );

    const [updated] = await tx
      .update(sessionsTable)
      .set({ milestone })
      .where(eq(sessionsTable.id, id))
      .returning(sessionColumns);
    return updated ?? null;
  });
};
