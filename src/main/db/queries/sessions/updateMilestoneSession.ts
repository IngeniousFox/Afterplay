import { and, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable, stateEventsTable } from '../../schema';

// Corregir la fecha de una sesión MARCADORA (las de duración 0 con
// `milestone` que crea "I played this before" para anclar el inicio/fin de
// un playthrough manual — ver createGameWithDetails.ts). Solo marcadores:
// una sesión real trackeada por el watcher es una medición, no una entrada
// manual, y su fecha no se falsea.
//
// En la MISMA transacción se corrigen también los stateEvents de esa
// iteración que nacieron con el marcador: se crearon juntos, en la misma
// transacción y con exactamente la misma fecha (ver createGameWithDetails/
// promotePlannedGame/EditGameModal), así que "mismo occurredAt que el
// marcador viejo" los identifica de forma fiable. Sin esto, corregir el día
// arreglaría las fechas del playthrough pero el historial seguiría
// enseñando la fecha equivocada.
export const updateMilestoneSession = async (
  id: number,
  date: Date,
  precision: 'year' | 'month' | 'day',
): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select(sessionColumns)
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1);
    if (!session) return null;
    if (session.milestone === null) {
      throw new Error(`La sesión ${id} no es un marcador manual — su fecha no se edita`);
    }

    // El TIPO forma parte del match a propósito: un playthrough empezado y
    // terminado el MISMO día deja los dos eventos (started y el terminal)
    // con timestamp idéntico — sin filtrar por tipo, corregir el marcador de
    // inicio arrastraría también el evento del otro extremo (sin mover su
    // marcador), descuadrando fechas de sesión y de historial entre sí. El
    // milestone del marcador coincide 1:1 con el tipo de evento que nació
    // con él ('started'/'completed'/'dropped'/'on_hold').
    await tx
      .update(stateEventsTable)
      .set({ occurredAt: date, datePrecision: precision })
      .where(
        and(
          eq(stateEventsTable.iterationId, session.iterationId),
          eq(stateEventsTable.occurredAt, session.startedAt),
          eq(stateEventsTable.type, session.milestone),
        ),
      );

    const [updated] = await tx
      .update(sessionsTable)
      .set({ startedAt: date, endedAt: date, datePrecision: precision })
      .where(eq(sessionsTable.id, id))
      .returning(sessionColumns);
    return updated ?? null;
  });
};
