import { asc, eq, inArray } from 'drizzle-orm';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { deriveGameDetail } from '../../../src/shared/domain/gameDetail';
import type { EventDatePrecision, GameDetail, IterationDetail, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { isSessionLive } from './timer';

// La ficha completa de un juego para el móvil.
//
// Fue un PUERTO a mano de getGameById.ts, y sus comentarios documentaban tres
// divergencias ya pagadas (la ventana de gasto cerrada con la última fila del
// log, su borde '<' en vez de '<=', el inicio arrastrado por sesiones
// manuales). Ya no hay puerto: las derivaciones —fechas, estado, horas,
// reparto del gasto, en vivo— salen de src/shared/domain/gameDetail.ts
// (deriveGameDetail), la MISMA función que llama el escritorio
// (AFTERPLAY-2.0.md §15.2, F-26). Aquí solo se traen las filas y se pasan a
// epoch para el JSON.
//
// El `db` entra por parámetro en vez de salir de un singleton de módulo
// (regla 1 del §5.2, ver db.ts).

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

  // "En vivo" es la MISMA vara que la lista y el barrido del cronómetro
  // (isSessionLive, queries/timer.ts): abierta Y fresca. Miraba solo
  // `endedAt === null`, y con eso la ficha pintaba LIVE un cronómetro que la
  // lista ya había dejado de pintar. En el escritorio no hace falta pasarla
  // porque allí el watcher barre las rancias antes de que nadie lea; aquí, con
  // el PC apagado, no barre nadie (ver deriveGameDetail).
  //
  // El reloj sale de Date.now() y no de un parámetro, igual que en
  // buildLibraryData: la ficha no es una puerta del cronómetro, es una lectura
  // más. Y no cierra nada: esto es un GET que lee.
  const now = Date.now();
  const derived = deriveGameDetail({
    iterations,
    sessions,
    stateEvents,
    spendEvents,
    isRunning: (session) => isSessionLive(session, now),
  });

  const iterationDetails: IterationDetail[] = derived.iterations.map((entry) => ({
    id: entry.iteration.id,
    label: entry.iteration.label,
    playedPlatform: entry.iteration.playedPlatform,
    origin: entry.iteration.origin,
    format: entry.iteration.format,
    manualTotalPlayed: entry.iteration.manualTotalPlayed,
    rating: entry.iteration.rating,
    extraContent: entry.iteration.extraContent,
    hours: entry.hours,
    startedAt: entry.startedAt ? ms(entry.startedAt) : null,
    endedAt: entry.endedAt ? ms(entry.endedAt) : null,
    startEvent: entry.startEvent
      ? {
          id: entry.startEvent.id,
          occurredAt: ms(entry.startEvent.occurredAt),
          datePrecision: entry.startEvent.datePrecision as EventDatePrecision,
        }
      : null,
    endEvent: entry.endEvent
      ? {
          id: entry.endEvent.id,
          occurredAt: ms(entry.endEvent.occurredAt),
          datePrecision: entry.endEvent.datePrecision as EventDatePrecision,
        }
      : null,
    startedBySession: entry.startedBySession,
    currentState: (entry.currentState as StateType) ?? null,
    // Más reciente primero: es el orden en que el móvil pinta el historial
    // (presentación, no regla).
    sessions: entry.sessions
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
    spend: entry.spend,
  }));

  return {
    ...game,
    addedAt: ms(game.addedAt),
    firstPlannedAt: derived.firstPlanEvent ? ms(derived.firstPlanEvent.occurredAt) : null,
    releaseDate: game.releaseDate ? ms(game.releaseDate) : null,
    totalHours: derived.totalHours,
    currentState: (derived.currentState as StateType) ?? null,
    isLive: derived.isLive,
    liveSince: derived.liveSince ? ms(derived.liveSince) : null,
    totalSpend: derived.totalSpend,
    costPerHour: derived.costPerHour,
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
