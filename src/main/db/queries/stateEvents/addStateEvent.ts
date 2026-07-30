import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDb } from '../..';
import { closesOpenSession, latestRealStateEvent } from '../../../../shared/playthroughState';
import type { AddStateEventInput, StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import { computeDurationSec } from '../sessions/sessionDuration';

// Apilar un evento en el log de estados — la escritura por la que pasa todo
// cambio de estado de la app, venga del menú Status, del Edit, del watcher o
// de dar de alta un juego.
//
// Es una transacción de tres tramos, y los tres tienen que ir juntos o
// ninguno:
//
//   1. Auto-pausa. Si esto es un 'started', cualquier playthrough hermano que
//      siguiera activo recibe un 'on_hold' — el invariante de "como mucho uno
//      activo por juego" (SPEC 4.5) se garantiza AQUÍ y no en la UI, para que
//      se cumpla venga la orden de donde venga.
//   2. El INSERT del evento.
//   3. Cierre de la sesión abierta, si el estado nuevo lo pide
//      (closesOpenSession). Sin esto, terminar un juego que sigue en marcha
//      dejaba sus horas sin contar hasta que el watcher notara el cierre real.
export const addStateEvent = async (input: AddStateEventInput): Promise<StateEvent> => {
  const db = getDb();
  // Resuelto una sola vez y reutilizado en todo lo demás (pausa de hermanos,
  // el propio evento, cierre de sesión) — si se dejara que cada sitio llamara
  // su propio `new Date()`, el evento y la sesión que cierra por su causa
  // quedarían con instantes distintos por unos milisegundos.
  const occurredAt = input.occurredAt ?? new Date();

  return db.transaction(async (tx) => {
    // SPEC 4.5: máximo un playthrough activo por juego — empezar uno nuevo
    // pausa el que estuviera en marcha. Se resuelve aquí y no en la UI para
    // que el invariante se cumpla venga de donde venga la orden.
    if (input.type === 'started') {
      const [iteration] = await tx
        .select({ gameId: iterationsTable.gameId })
        .from(iterationsTable)
        .where(eq(iterationsTable.id, input.iterationId))
        .limit(1);

      // Si la iteración no existe, el insert de abajo revienta por FK igual —
      // no hace falta duplicar esa comprobación aquí.
      if (iteration) {
        const siblings = await tx
          .select({ id: iterationsTable.id })
          .from(iterationsTable)
          .where(
            and(
              eq(iterationsTable.gameId, iteration.gameId),
              ne(iterationsTable.id, input.iterationId),
            ),
          );

        if (siblings.length > 0) {
          const siblingEvents = await tx
            .select(stateEventColumns)
            .from(stateEventsTable)
            .where(
              inArray(
                stateEventsTable.iterationId,
                siblings.map((sibling) => sibling.id),
              ),
            );

          // El último estado REAL por hermano — misma regla (ignorar
          // 'plan_to_play') que getGames/getGameById/resolveIterationForPlay.
          // Sin el filtro, un juego promovido del Plan con fechas del pasado
          // (started retroactivo anterior al plan_to_play) parecía "no
          // activo" aquí mientras el resto de la app lo mostraba Playing, y
          // la auto-pausa no saltaba: dos playthroughs activos a la vez.
          const eventsBySibling = new Map<number, StateEvent[]>();
          for (const event of siblingEvents) {
            const list = eventsBySibling.get(event.iterationId);
            if (list) list.push(event);
            else eventsBySibling.set(event.iterationId, [event]);
          }

          for (const [siblingId, events] of eventsBySibling) {
            const latest = latestRealStateEvent(events);
            if (!latest) continue;
            const siblingIsActive = latest.type === 'started';
            // Registrar un started del PASADO (un playthrough manual viejo)
            // no debe pausar nada del presente: solo se pausa al hermano si
            // este started es posterior a su último evento.
            const newEventIsMoreRecent = latest.occurredAt.getTime() <= occurredAt.getTime();

            if (siblingIsActive && newEventIsMoreRecent) {
              await tx.insert(stateEventsTable).values({
                iterationId: siblingId,
                type: 'on_hold',
                occurredAt,
                datePrecision: input.datePrecision,
                note: 'Pausado automáticamente al empezar otro playthrough.',
              });
            }
          }
        }
      }
    }

    const [event] = await tx
      .insert(stateEventsTable)
      .values({ ...input, occurredAt })
      .returning(stateEventColumns);

    if (closesOpenSession(input.type)) {
      // Terminas mientras el juego sigue en marcha (sesión del watcher
      // todavía abierta): se cierra AQUÍ, en el instante del hito — si no,
      // sus horas se quedarían sin contar (durationSec null mientras está
      // abierta) hasta que el watcher detecte el cierre real más tarde.
      // Modelo v2: la fecha de "fin" del playthrough ES este propio evento
      // (derivada al leer) — ya no hay ancla endSessionId que mantener.
      const [openSession] = await tx
        .select({ id: sessionsTable.id, startedAt: sessionsTable.startedAt })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.iterationId, input.iterationId), isNull(sessionsTable.endedAt)))
        .limit(1);

      if (openSession) {
        const durationSec = computeDurationSec(openSession.startedAt, occurredAt);
        await tx
          .update(sessionsTable)
          .set({ endedAt: occurredAt, durationSec })
          .where(eq(sessionsTable.id, openSession.id));
      }
    }

    return event;
  });
};
