import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDb } from '../..';
import { closesOpenSession, latestRealStateEvent } from '../../../../shared/playthroughState';
import type { AddStateEventInput, StateEvent } from '../../../../shared/types';
import { stateEventColumns } from '../../projections';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
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
//   3. Cierre de las sesiones abiertas, si el estado nuevo lo pide
//      (closesOpenSession) y el hito no viene fechado antes de que la sesión
//      empezara. Sin esto, terminar un juego que sigue en marcha dejaba sus
//      horas sin contar hasta que el watcher notara el cierre real. Y también
//      la del hermano pausado en el tramo 1, que antes se quedaba viva.

// Cierra las sesiones que ese playthrough tuviera abiertas, fechándolas en el
// instante del hito. Vive aparte porque hacen falta DOS llamadas: la del
// playthrough que recibe el evento, y la del hermano al que se pausa
// automáticamente (que antes se quedaba viva — ver el sitio de la pausa).
//
// TODAS las abiertas, en plural, y esa es una cicatriz: antes esto era un
// `.limit(1)` SIN ORDER BY, o sea una fila al azar del plan de SQLite. Un
// playthrough puede acabar con dos sesiones vivas —assignSession engancha una
// sesión de emulador pendiente a una iteración que ya tenía la del watcher—, y
// con el limit(1) el hito cerraba una y dejaba la otra colgando para siempre;
// peor aún, si la elegida era la vieja y el hito caía entre las dos, la guarda
// de abajo no se cumplía ni para esa y no se cerraba NINGUNA. Una sesión viva
// que nadie va a cerrar deja el juego isLive true, y como el dedup de
// startGameSession es por JUEGO, el watcher tampoco puede abrir la siguiente.
// El ORDER BY no cambia el resultado (se recorren todas) pero deja los UPDATE
// en un orden estable, que es lo que la captura de cambios del sync envía.
//
// LA GUARDA DE LA FECHA es lo importante, y se evalúa POR SESIÓN: se cierra
// la que empezó en el instante del hito o antes, nunca la que arrancó después.
// El Edit rellena `occurredAt` con el picker "Finished / left", que acepta
// cualquier fecha del pasado: pasar a Beaten con la fecha real en que lo
// terminaste (una semana atrás) mientras el juego SIGUE corriendo cerraba la
// sesión viva con endedAt anterior a su propio startedAt y durationSec 0
// —computeDurationSec hace Math.max(0, …) pensando en un reloj raro—, o sea
// las horas medidas de esa tarde a la basura. Y sin arreglo posible después:
// cerrar es idempotente a propósito, así que al morir el proceso el watcher la
// ve cerrada y la deja tal cual. Un hito fechado en el pasado es una
// corrección del historial, no el final de la partida de ahora — esa la cierra
// el watcher cuando muera el proceso.
//
// El corte es `>=` y no `>` a propósito: un hito EXACTAMENTE en el arranque sí
// cierra, con durationSec 0. Arrancar el juego y marcarlo Dropped acto seguido
// tiene que dejar una sesión de cero segundos, no una abierta para siempre.
// (Este comentario decía "solo si el hito cae DESPUÉS del inicio" mientras el
// código comparaba con `>=`; la palabra de más invitaba a "corregir" el borde
// hacia el lado malo en cualquier refactor.)
const closeOpenSessionsAt = async (
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  iterationId: number,
  occurredAt: Date,
): Promise<void> => {
  const openSessions = await tx
    .select({ id: sessionsTable.id, startedAt: sessionsTable.startedAt })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.iterationId, iterationId), isNull(sessionsTable.endedAt)))
    .orderBy(asc(sessionsTable.startedAt), asc(sessionsTable.id));

  for (const openSession of openSessions) {
    if (occurredAt.getTime() < openSession.startedAt.getTime()) continue;

    await tx
      .update(sessionsTable)
      .set({
        endedAt: occurredAt,
        durationSec: computeDurationSec(openSession.startedAt, occurredAt),
      })
      .where(eq(sessionsTable.id, openSession.id));
  }
};

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
        .select({ gameId: iterationsTable.gameId, endless: gamesTable.endless })
        .from(iterationsTable)
        .innerJoin(gamesTable, eq(gamesTable.id, iterationsTable.gameId))
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
              // La pausa habla el vocabulario del juego: 'on_hold' es de los
              // playthroughs discretos, y un ENDLESS no los tiene — su pausa
              // es 'resting' (ENDLESS_STATUS_OPTIONS). Sin esta distinción, un
              // endless con más de un contenedor (una conversión desde normal
              // los conserva todos) recibía un On Hold que su propio selector
              // de estados ni ofrece.
              await tx.insert(stateEventsTable).values({
                iterationId: siblingId,
                type: iteration.endless ? 'resting' : 'on_hold',
                occurredAt,
                datePrecision: input.datePrecision,
                note: iteration.endless
                  ? 'Puesto a descansar automáticamente.'
                  : 'Pausado automáticamente al empezar otro playthrough.',
              });

              // Y SE LE CIERRA LA SESIÓN, igual que si esa pausa la hubieras
              // escrito tú a mano. 'on_hold' y 'resting' están los dos en
              // CLOSES_OPEN_SESSION, pero el cierre de más abajo se decide con
              // `input.type` —que aquí vale 'started'—, así que el evento que
              // esta misma función acaba de fabricar no pasaba por él.
              //
              // Lo que quedaba: un playthrough On Hold con una sesión viva
              // colgando y el juego marcado isLive. Y peor, porque el dedup de
              // startGameSession es por JUEGO: mientras esa sesión fantasma
              // siguiera abierta, el watcher no podía abrir una nueva para el
              // playthrough que SÍ estás jugando.
              await closeOpenSessionsAt(tx, siblingId, occurredAt);
            }
          }
        }
      }
    }

    const [event] = await tx
      .insert(stateEventsTable)
      .values({ ...input, occurredAt })
      .returning(stateEventColumns);

    // Terminas mientras el juego sigue en marcha (sesión del watcher todavía
    // abierta): se cierra en el instante del hito — si no, sus horas se
    // quedarían sin contar (durationSec null mientras está abierta) hasta que
    // el watcher detecte el cierre real más tarde. Modelo v2: la fecha de
    // "fin" del playthrough ES este propio evento (derivada al leer) — ya no
    // hay ancla endSessionId que mantener.
    if (closesOpenSession(input.type)) {
      await closeOpenSessionsAt(tx, input.iterationId, occurredAt);
    }

    return event;
  });
};
