import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '../..';
import type { AddStateEventInput, StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import { computeDurationSec } from '../sessions/sessionDuration';
import { latestRealStateEvent } from './latestRealStateEvent';

// Hitos que cierran un playthrough (todo salvo 'started'). Al registrar uno se
// ancla una sesión como endSessionId de la iteración, de la que se derivan su
// fecha de "fin" y qué sesión marcó el hito (ver el bloque de anclaje abajo).
const TERMINAL_TYPES = new Set(['completed', 'dropped', 'on_hold', 'resting']);

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

    if (TERMINAL_TYPES.has(input.type)) {
      // El hito de cierre se ancla a una sesión para derivar la fecha de "fin"
      // de la iteración (Finished/left) y saber qué sesión lo marcó (SPEC 4.5:
      // "fin = última sesión / evento de cierre"). Sin sesiones (un juego que
      // se marca sin haberlo jugado nunca en la app) no hay nada que anclar y
      // "fin" se queda en blanco.
      const sessions = await tx
        .select({
          id: sessionsTable.id,
          startedAt: sessionsTable.startedAt,
          endedAt: sessionsTable.endedAt,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.iterationId, input.iterationId))
        .orderBy(asc(sessionsTable.startedAt), asc(sessionsTable.id));

      const openSession = sessions.find((session) => session.endedAt === null);
      let endSessionId: number | undefined;

      if (openSession) {
        // Terminas mientras el juego sigue en marcha (sesión del watcher
        // todavía abierta): se cierra AQUÍ, en el instante del hito — si no,
        // sus horas se quedarían sin contar (durationSec null mientras está
        // abierta) hasta que el watcher detecte el cierre real más tarde, y
        // "Finished/left" mostraría el INICIO de esa sesión en vez de ahora.
        const durationSec = computeDurationSec(openSession.startedAt, occurredAt);
        await tx
          .update(sessionsTable)
          .set({ endedAt: occurredAt, durationSec })
          .where(eq(sessionsTable.id, openSession.id));
        endSessionId = openSession.id;
      } else {
        // Lo normal cuando marcas el estado DESPUÉS de cerrar el juego (el
        // watcher ya cerró la sesión al detectar el cierre): se ancla a la
        // última.
        endSessionId = sessions[sessions.length - 1]?.id;
      }

      if (endSessionId) {
        await tx
          .update(iterationsTable)
          .set({ endSessionId })
          .where(eq(iterationsTable.id, input.iterationId));
      }
    }

    return event;
  });
};
