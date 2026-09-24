import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import {
  endsPlaythrough,
  latestRealStateEvent,
  leavesEndDate,
} from '../../../../shared/playthroughState';
import type { GameDetail, IterationDetail } from '../../../../shared/types';
import {
  gameColumns,
  iterationColumns,
  sessionColumns,
  spendEventColumns,
  stateEventColumns,
} from '../../projections';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../schema';
import { resolveIterationHours } from './iterationHours';
import { canMoveToPlanWhere } from './moveToPlan';

// La ficha completa de un juego, y con ella el corazón de las derivaciones
// (SPEC 4.4): aquí es donde el log de eventos se convierte en las fechas, el
// estado y las horas que enseña la app. Nada de eso está almacenado.
//
// Cinco SELECTs y todo el trabajo en JS: agrupar en memoria una vez es más
// simple y más barato que pelearse con JOINs que repiten filas.
//
// Y aquí NO se agrega en SQL como sí hace ya getGames con las sesiones, a
// propósito: esta consulta no se trae ni una fila que no acabe VIAJANDO al
// renderer — las sesiones son el Session History, los stateEvents el Journey
// y los spendEvents el historial de gasto. No hay nada que colapsar. Medido
// sobre la biblioteca real: 1,0 ms de media y 1,4 ms el peor de los 333 (el
// juego con 20 sesiones); con 95 sesiones en un solo juego, 2,7 ms. El coste
// crece con lo que la ficha ENSEÑA, que es lo justo.
//
// Por iteración salen: las horas (manual + trackeado), la fecha de inicio (lo
// más temprano entre su primera sesión MEDIDA y su primer 'started'), la de
// fin (el último evento terminal, y SOLO si sigue en ese estado ahora — uno
// reabierto no tiene fin), su estado actual y su parte del gasto.
export const getGameById = async (id: number): Promise<GameDetail | null> => {
  const db = getDb();

  const [game] = await db
    .select(gameColumns)
    .from(gamesTable)
    .where(eq(gamesTable.id, id))
    .limit(1);
  if (!game) return null;

  const iterations = await db
    .select(iterationColumns)
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, id))
    .orderBy(asc(iterationsTable.id));
  const iterationIds = iterations.map((iteration) => iteration.id);

  // Si el juego no tiene iteraciones todavía (añadido pero sin tocar), no
  // hay nada que buscar en sessions/stateEvents:
  // evito el inArray con array vacío, que en SQL sería un "IN ()" inválido.
  const sessions = iterationIds.length
    ? await db
        .select(sessionColumns)
        .from(sessionsTable)
        .where(inArray(sessionsTable.iterationId, iterationIds))
    : [];

  const stateEvents = iterationIds.length
    ? await db
        .select(stateEventColumns)
        .from(stateEventsTable)
        .where(inArray(stateEventsTable.iterationId, iterationIds))
        .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id))
    : [];

  const spendEvents = await db
    .select(spendEventColumns)
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, id))
    .orderBy(asc(spendEventsTable.occurredAt), asc(spendEventsTable.id));

  // Agrupo sessions y stateEvents por iterationId una sola vez, en vez de
  // filtrar el array entero por cada iteración dentro del map de abajo.
  const sessionsByIteration = new Map<number, typeof sessions>();
  for (const session of sessions) {
    // iterationId nullable en el tipo (sesiones de emulador pendientes),
    // pero aquí imposible: la query filtra por inArray(iterationId, ids).
    if (session.iterationId === null) continue;
    const list = sessionsByIteration.get(session.iterationId) ?? [];
    list.push(session);
    sessionsByIteration.set(session.iterationId, list);
  }

  const stateEventsByIteration = new Map<number, typeof stateEvents>();
  for (const event of stateEvents) {
    const list = stateEventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    stateEventsByIteration.set(event.iterationId, list);
  }

  // Reparto de gasto entre playthroughs — spendEvents no llevan iterationId
  // (SPEC 4, el gasto es del juego, no de un playthrough concreto), así que
  // se infiere por fecha: cada gasto cae en el primer playthrough que
  // seguía "abierto" (sin terminar en completed/dropped) en su fecha. Un
  // playthrough ya terminado no puede reclamar gasto ESTRICTAMENTE posterior
  // a su cierre — eso pasa al siguiente playthrough (o al último si no hay
  // más). Un gasto muy anterior al primer playthrough (el juego comprado
  // semanas antes de arrancarlo) cae en ese primer playthrough. on_hold/
  // resting no cierran la ventana (mismo criterio que crear una iteración
  // nueva al volver a "Playing", ver StatusCard.tsx/ActionBar.tsx).
  //
  // El instante del cierre entra TODAVÍA en su propia ventana ('<=' y no
  // '<'), y eso es una corrección, no un detalle: la fecha del completed y la
  // del gasto se teclean las dos con precisión de día (medianoche), así que
  // comprar el DLC el mismo día que te pasas el juego empata exacto. Con el
  // '<' estricto ese dinero se le colgaba al playthrough siguiente, que ese
  // día ni existía —el siguiente puede arrancar meses después—. El día que lo
  // cerraste todavía estabas jugándolo.
  //
  // El "último" sale del helper compartido y no de la última fila del array:
  // ignora 'plan_to_play' (historial de intención, nunca estado) y desempata
  // por id, así que tampoco depende del ORDER BY de la query. Con la última
  // fila a secas, cualquier juego promovido desde el Plan tenía su
  // plan_to_play —fechado AHORA por createPlannedGame— tapando el
  // completed/dropped que se tecleó con fecha del pasado: terminalAt = null,
  // la ventana del Playthrough 1 no se cerraba nunca y todo el gasto
  // posterior (el DLC de años después) se le colgaba a él en vez de al
  // playthrough que estaba abierto en esa fecha.
  const terminalAtByIteration = new Map<number, Date | null>();
  for (const iteration of iterations) {
    const events = stateEventsByIteration.get(iteration.id) ?? [];
    const latest = latestRealStateEvent(events);
    terminalAtByIteration.set(
      iteration.id,
      latest && endsPlaythrough(latest.type) ? latest.occurredAt : null,
    );
  }

  const spendByIteration = new Map<number, number>();
  for (const spend of spendEvents) {
    let chosen = iterations[0];
    for (const iteration of iterations) {
      chosen = iteration;
      const terminalAt = terminalAtByIteration.get(iteration.id) ?? null;
      if (terminalAt === null || spend.occurredAt <= terminalAt) break;
    }
    if (chosen) {
      spendByIteration.set(chosen.id, (spendByIteration.get(chosen.id) ?? 0) + spend.amount);
    }
  }

  const iterationDetails: IterationDetail[] = iterations.map((iteration) => {
    const iterationSessions = sessionsByIteration.get(iteration.id) ?? [];
    const trackedSeconds = iterationSessions.reduce(
      (sum, session) => sum + (session.durationSec ?? 0),
      0,
    );

    const hours = resolveIterationHours(iteration.manualTotalPlayed, trackedSeconds);

    const iterationStateEvents = stateEventsByIteration.get(iteration.id) ?? [];
    // Ignorando 'plan_to_play': es solo historial (ver schema.ts), nunca el
    // estado real — un juego promovido desde el Plan como Unplayed no tiene
    // más eventos y debe salir null (Unplayed), no "planeado".
    const latestEvent = latestRealStateEvent(iterationStateEvents);

    // Modelo v2 — fechas DERIVADAS, el log de estados es la fuente de
    // verdad. Inicio: lo más temprano entre la primera sesión MEDIDA y el
    // primer evento 'started' (los eventos vienen ya ordenados asc de la
    // query). Fin: la fecha del último evento terminal, solo si el
    // playthrough ESTÁ en un estado terminal ahora (uno reabierto no tiene
    // "fin" aunque tuviera un completed antiguo en el log).
    //
    // El '!isManual' no es cosmético: una sesión manual es un bloque de horas
    // TECLEADO (filas heredadas del modelo v1), no algo que el watcher viera
    // pasar. Sin el filtro, una de esas filas de 2020 arrastraba el inicio
    // hasta su fecha gruesa y, peor, ponía startedBySession=true — que es
    // justo la señal con la que el Edit bloquea la fecha "porque una medición
    // no se falsea" (IterationSection.tsx, EditGameModal.tsx, handleSave.ts):
    // se bloqueaba la edición de una fecha que nadie midió, y encima sin
    // ningún evento que corregir. Mismo criterio que Stats y
    // shared/memory/moments.ts, que ya descartaban esas filas.
    const startEventRow = iterationStateEvents.find((event) => event.type === 'started') ?? null;
    const firstSessionAt = iterationSessions.reduce<Date | null>(
      (earliest, session) =>
        !session.isManual && (earliest === null || session.startedAt.getTime() < earliest.getTime())
          ? session.startedAt
          : earliest,
      null,
    );
    const startedBySession =
      firstSessionAt !== null &&
      (startEventRow === null || firstSessionAt.getTime() < startEventRow.occurredAt.getTime());
    const startedAt = startedBySession ? firstSessionAt : (startEventRow?.occurredAt ?? null);

    const endEventRow = leavesEndDate(latestEvent?.type) ? latestEvent : null;

    return {
      ...iteration,
      hours,
      startedAt,
      endedAt: endEventRow?.occurredAt ?? null,
      startEvent: startEventRow
        ? {
            id: startEventRow.id,
            occurredAt: startEventRow.occurredAt,
            datePrecision: startEventRow.datePrecision,
          }
        : null,
      endEvent: endEventRow
        ? {
            id: endEventRow.id,
            occurredAt: endEventRow.occurredAt,
            datePrecision: endEventRow.datePrecision,
          }
        : null,
      startedBySession,
      currentState: latestEvent?.type ?? null,
      sessions: iterationSessions,
      spend: spendByIteration.get(iteration.id) ?? 0,
    };
  });

  const totalHours = iterationDetails.reduce((sum, iteration) => sum + iteration.hours, 0);
  const totalSpend = spendEvents.reduce((sum, spend) => sum + spend.amount, 0);

  const costPerHour = totalHours > 0 ? totalSpend / totalHours : null;

  const isLive = sessions.some((session) => session.endedAt === null);
  // Mismo filtro de 'plan_to_play' que arriba (solo historial, nunca estado).
  const latestStateEvent = latestRealStateEvent(stateEvents);
  const canMoveToPlan = game.planned
    ? false
    : (
        await db
          .select({ id: gamesTable.id })
          .from(gamesTable)
          .where(and(eq(gamesTable.id, id), canMoveToPlanWhere(id)))
          .limit(1)
      ).length > 0;

  return {
    ...game,
    totalHours,
    currentState: latestStateEvent?.type ?? null,
    isLive,
    totalSpend,
    costPerHour,
    stateHistory: stateEvents,
    spendHistory: spendEvents,
    iterations: iterationDetails,
    canMoveToPlan,
  };
};
