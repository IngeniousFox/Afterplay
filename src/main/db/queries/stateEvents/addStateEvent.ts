import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDb } from '../..';
import type { AddStateEventInput, StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { iterationsTable, sessionsTable, stateEventsTable } from '../../schema';

// Hitos que cierran un playthrough (todo salvo 'started') — si la iteración
// tiene una sesión sin cerrar cuando se registra uno de estos, se ancla como
// endSessionId (SPEC 4: "al marcar un hito con sesión activa, asociarlo a la
// última sesión"). Hoy no hay nada que deje sesiones abiertas (el watcher del
// Bloque 3 no existe todavía, y las manuales siempre llegan con endedAt ya
// puesto), pero la asociación tiene que estar lista para cuando lo haya.
const TERMINAL_TYPES = new Set(['completed', 'dropped', 'on_hold', 'resting']);

export const addStateEvent = async (input: AddStateEventInput): Promise<StateEvent> => {
  const db = getDb();

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
            )
            .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));

          // Vienen ordenados, así que quedarse con el último por iteración es
          // ir machacando la entrada del Map en cada vuelta.
          const latestBySibling = new Map<number, StateEvent>();
          for (const event of siblingEvents) {
            latestBySibling.set(event.iterationId, event);
          }

          const occurredAt = input.occurredAt ?? new Date();

          for (const [siblingId, latest] of latestBySibling) {
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

    const [event] = await tx.insert(stateEventsTable).values(input).returning(stateEventColumns);

    if (TERMINAL_TYPES.has(input.type)) {
      const [openSession] = await tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.iterationId, input.iterationId), isNull(sessionsTable.endedAt)))
        .limit(1);

      if (openSession) {
        await tx
          .update(iterationsTable)
          .set({ endSessionId: openSession.id })
          .where(eq(iterationsTable.id, input.iterationId));
      }
    }

    return event;
  });
};
