import { asc, eq, inArray } from 'drizzle-orm';
import { resolveIterationHours } from '../../../src/main/db/queries/games/iterationHours';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import {
  endsPlaythrough,
  latestRealStateEvent,
  leavesEndDate,
} from '../../../src/shared/playthroughState';
import type { EventDatePrecision, GameDetail, IterationDetail, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { isSessionLive } from './timer';

// La ficha completa, portada de getGameById.ts del escritorio.
//
// Es EL sitio donde el log de eventos se convierte en las fechas, el estado y
// las horas que se enseñan (SPEC 4.4): nada de eso está almacenado. Se porta
// entera y no "lo esencial" porque las derivaciones tienen casos límite que
// costaron caro descubrir —el reparto del gasto entre playthroughs, el inicio
// que puede venir de una sesión en vez de un evento, el fin que solo cuenta si
// el playthrough SIGUE en estado terminal— y una versión simplificada aquí
// sería una segunda verdad que se contradice con la app.
//
// La única diferencia estructural: el `db` entra por parámetro en vez de salir
// de un singleton de módulo (regla 1 del §5.2, ver db.ts).

const ms = (date: Date): number => date.getTime();

export const getGameDetail = async (db: TenantDb, id: number): Promise<GameDetail | null> => {
  const [game] = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      igdbId: gamesTable.igdbId,
      steamAppId: gamesTable.steamAppId,
      releaseYear: gamesTable.releaseYear,
      releaseDate: gamesTable.releaseDate,
      releaseDatePrecision: gamesTable.releaseDatePrecision,
      genres: gamesTable.genres,
      officialPlatforms: gamesTable.officialPlatforms,
      developer: gamesTable.developer,
      publisher: gamesTable.publisher,
      summary: gamesTable.summary,
      igdbCollections: gamesTable.igdbCollections,
      installDirectory: gamesTable.installDirectory,
      installSizeBytes: gamesTable.installSizeBytes,
      executablePath: gamesTable.executablePath,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
      planned: gamesTable.planned,
      addedAt: gamesTable.addedAt,
      notes: gamesTable.notes,
      hltbMain: gamesTable.hltbMain,
      hltbMainExtras: gamesTable.hltbMainExtras,
      hltbCompletionist: gamesTable.hltbCompletionist,
      ratingCritics: gamesTable.ratingCritics,
      ratingCriticsCount: gamesTable.ratingCriticsCount,
      ratingUsers: gamesTable.ratingUsers,
      ratingUsersCount: gamesTable.ratingUsersCount,
      steamTags: gamesTable.steamTags,
      steamPositive: gamesTable.steamPositive,
      steamNegative: gamesTable.steamNegative,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, id))
    .limit(1);

  if (!game) return null;

  const iterations = await db
    .select({
      id: iterationsTable.id,
      label: iterationsTable.label,
      playedPlatform: iterationsTable.playedPlatform,
      origin: iterationsTable.origin,
      format: iterationsTable.format,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
      rating: iterationsTable.rating,
      extraContent: iterationsTable.extraContent,
    })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, id))
    .orderBy(asc(iterationsTable.id));

  const iterationIds = iterations.map((iteration) => iteration.id);

  // Un juego añadido pero sin tocar no tiene iteraciones, y un inArray con
  // array vacío genera un "IN ()" que SQL rechaza.
  const sessions = iterationIds.length
    ? await db
        .select({
          id: sessionsTable.id,
          iterationId: sessionsTable.iterationId,
          emulatorId: sessionsTable.emulatorId,
          isManual: sessionsTable.isManual,
          startedAt: sessionsTable.startedAt,
          endedAt: sessionsTable.endedAt,
          durationSec: sessionsTable.durationSec,
          datePrecision: sessionsTable.datePrecision,
          note: sessionsTable.note,
          // Los dos últimos no se pintan: son para isSessionLive, que necesita
          // saber quién abrió la sesión y cuándo latió por última vez.
          startedBy: sessionsTable.startedBy,
          lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
        })
        .from(sessionsTable)
        .where(inArray(sessionsTable.iterationId, iterationIds))
    : [];

  const stateEvents = iterationIds.length
    ? await db
        .select({
          id: stateEventsTable.id,
          iterationId: stateEventsTable.iterationId,
          type: stateEventsTable.type,
          occurredAt: stateEventsTable.occurredAt,
          datePrecision: stateEventsTable.datePrecision,
          note: stateEventsTable.note,
        })
        .from(stateEventsTable)
        .where(inArray(stateEventsTable.iterationId, iterationIds))
        .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id))
    : [];

  const spendEvents = await db
    .select({
      id: spendEventsTable.id,
      type: spendEventsTable.type,
      amount: spendEventsTable.amount,
      occurredAt: spendEventsTable.occurredAt,
      datePrecision: spendEventsTable.datePrecision,
      note: spendEventsTable.note,
    })
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, id))
    .orderBy(asc(spendEventsTable.occurredAt), asc(spendEventsTable.id));

  const sessionsByIteration = new Map<number, typeof sessions>();
  for (const session of sessions) {
    if (session.iterationId === null) continue;
    const list = sessionsByIteration.get(session.iterationId) ?? [];
    list.push(session);
    sessionsByIteration.set(session.iterationId, list);
  }

  const eventsByIteration = new Map<number, typeof stateEvents>();
  for (const event of stateEvents) {
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  // Reparto del gasto entre playthroughs. Los gastos NO llevan iterationId (el
  // gasto es del juego, no de un recorrido concreto), así que se infiere por
  // fecha: cada gasto cae en el primer playthrough que seguía ABIERTO en esa
  // fecha. Uno ya terminado no puede reclamar gasto ESTRICTAMENTE posterior a
  // su cierre — eso pasa al siguiente. Un gasto anterior al primer playthrough
  // (el juego comprado semanas antes de arrancarlo) cae en ese primero.
  // on_hold y resting no cierran la ventana: son pausas, no finales.
  //
  // El "último" sale de latestRealStateEvent y no de la última fila del array,
  // y aquí eso se pagó DOS VECES: el escritorio lo arregló y este puerto se
  // quedó con la versión vieja, así que la misma ficha repartía el dinero
  // distinto en el móvil que en el PC. Cualquier juego promovido desde el Plan
  // conserva su 'plan_to_play' —fechado AHORA por createPlannedGame— y, como
  // los eventos llegan ordenados por occurredAt asc, ESA era la última fila:
  // tapaba el completed/dropped tecleado con fecha del pasado, terminalAt
  // salía null, la ventana del Playthrough 1 no se cerraba nunca y el DLC de
  // años después se le colgaba a él. El helper ignora 'plan_to_play' (es
  // historial de intención, nunca estado) y desempata por id, así que tampoco
  // depende del ORDER BY de la query.
  const terminalAtByIteration = new Map<number, Date | null>();
  for (const iteration of iterations) {
    const events = eventsByIteration.get(iteration.id) ?? [];
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
      // El instante del cierre entra TODAVÍA en su propia ventana ('<=' y no
      // '<'): la fecha del completed y la del gasto se teclean las dos con
      // precisión de día (medianoche), así que comprar el DLC el mismo día que
      // te pasas el juego empata exacto. Con el '<' estricto —que es lo que
      // este puerto arrastraba mientras el escritorio ya lo había corregido—
      // ese dinero se le colgaba al playthrough siguiente, que ese día ni
      // existía, y el móvil pintaba "Free" en el playthrough que sí lo pagó.
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

    const iterationEvents = eventsByIteration.get(iteration.id) ?? [];
    // Ignorando 'plan_to_play': es solo historial, nunca el estado real.
    const latestEvent = latestRealStateEvent(iterationEvents);

    // Modelo v2 — fechas DERIVADAS. Inicio: lo más temprano entre la primera
    // sesión MEDIDA y el primer evento 'started'. Fin: el último evento
    // terminal, y SOLO si el playthrough sigue en ese estado ahora — uno
    // reabierto no tiene fin aunque arrastre un 'completed' antiguo en el log.
    //
    // El '!isManual' no es cosmético y aquí faltaba: una sesión manual es un
    // bloque de horas TECLEADO (filas heredadas del modelo v1), no algo que el
    // watcher viera pasar. Sin el filtro, una de esas filas de 2020 arrastraba
    // el inicio hasta su fecha gruesa y ponía startedBySession=true — que es
    // justo el flag con el que la ficha del móvil pinta la fecha con precisión
    // 'datetime' (PlaythroughPanel.tsx), o sea que el móvil enseñaba un
    // instante exacto que nadie midió mientras el PC enseñaba el día tecleado
    // en el evento.
    const startEventRow = iterationEvents.find((event) => event.type === 'started') ?? null;
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
      id: iteration.id,
      label: iteration.label,
      playedPlatform: iteration.playedPlatform,
      origin: iteration.origin,
      format: iteration.format,
      manualTotalPlayed: iteration.manualTotalPlayed,
      rating: iteration.rating,
      extraContent: iteration.extraContent,
      hours,
      startedAt: startedAt ? ms(startedAt) : null,
      endedAt: endEventRow ? ms(endEventRow.occurredAt) : null,
      startEvent: startEventRow
        ? {
            id: startEventRow.id,
            occurredAt: ms(startEventRow.occurredAt),
            datePrecision: startEventRow.datePrecision as EventDatePrecision,
          }
        : null,
      endEvent: endEventRow
        ? {
            id: endEventRow.id,
            occurredAt: ms(endEventRow.occurredAt),
            datePrecision: endEventRow.datePrecision as EventDatePrecision,
          }
        : null,
      startedBySession,
      currentState: (latestEvent?.type as StateType) ?? null,
      sessions: iterationSessions
        .map((session) => ({
          id: session.id,
          iterationId: session.iterationId,
          emulatorId: session.emulatorId,
          isManual: session.isManual,
          startedAt: ms(session.startedAt),
          endedAt: session.endedAt ? ms(session.endedAt) : null,
          durationSec: session.durationSec,
          datePrecision: session.datePrecision as EventDatePrecision,
          note: session.note,
        }))
        .sort((a, b) => b.startedAt - a.startedAt),
      spend: spendByIteration.get(iteration.id) ?? 0,
    };
  });

  const totalHours = iterationDetails.reduce((sum, iteration) => sum + iteration.hours, 0);
  const totalSpend = spendEvents.reduce((sum, spend) => sum + spend.amount, 0);
  // "En vivo" es la MISMA vara que la lista y el barrido del cronómetro
  // (isSessionLive, queries/timer.ts): abierta Y fresca. Miraba solo
  // `endedAt === null`, y con eso la ficha pintaba LIVE un cronómetro que la
  // lista ya había dejado de pintar — dos pantallas de la misma app
  // contestando distinto a "¿está jugando?" hasta que alguien pedía
  // /api/timer, que es el único que barre.
  //
  // El reloj sale de Date.now() y no de un parámetro, igual que en
  // buildLibraryData: la ficha no es una puerta del cronómetro (esas cuatro sí
  // reciben `now` para no decidir la frescura con un reloj distinto del que el
  // router tiene en la mano), es una lectura más. Y no cierra nada: esto es un
  // GET que lee.
  const now = Date.now();
  const liveSession =
    sessions.find((session) => session.endedAt === null && isSessionLive(session, now)) ?? null;
  const latestStateEvent = latestRealStateEvent(stateEvents);

  return {
    ...game,
    addedAt: ms(game.addedAt),
    releaseDate: game.releaseDate ? ms(game.releaseDate) : null,
    totalHours,
    currentState: (latestStateEvent?.type as StateType) ?? null,
    isLive: liveSession !== null,
    liveSince: liveSession ? ms(liveSession.startedAt) : null,
    totalSpend,
    // Sin horas no hay coste por hora que calcular — dividir entre cero daría
    // Infinity, que en pantalla es peor que un guion.
    costPerHour: totalHours > 0 ? totalSpend / totalHours : null,
    iterations: iterationDetails,
    stateHistory: stateEvents.map((event) => ({
      id: event.id,
      iterationId: event.iterationId,
      type: event.type as StateType,
      occurredAt: ms(event.occurredAt),
      datePrecision: event.datePrecision as EventDatePrecision,
      note: event.note,
    })),
    spendHistory: spendEvents.map((spend) => ({
      id: spend.id,
      type: spend.type,
      amount: spend.amount,
      occurredAt: ms(spend.occurredAt),
      datePrecision: spend.datePrecision as EventDatePrecision,
      note: spend.note,
    })),
  };
};
