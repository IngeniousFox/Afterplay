import { eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameListItem, StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';

// Forma de una fila candidata a "evento de estado más reciente de este
// juego". La nombro explícitamente en vez de inferirla del array para no
// tener que ir a buscar la query cada vez que quiera saber qué trae.
type StateEventCandidate = {
  gameId: number;
  type: StateEvent['type'];
  occurredAt: Date;
  id: number;
};

export const getGames = async (): Promise<GameListItem[]> => {
  const db = getDb();

  // Alfabético, insensible a mayúsculas — sin esto SQLite ordena ASCII puro
  // (mayúsculas antes que minúsculas) y además devolvería el orden de
  // inserción si no se pide nada. Un único sitio para el orden: tanto la
  // biblioteca como el rail lateral (MiddleColumn) leen de este mismo query
  // vía useGames(), así que se ordenan igual en los dos sin más esfuerzo.
  //
  // Sin juegos planeados: la sección Plan to Play es la ÚNICA que los ve
  // (getPlannedGames) — al excluirlos aquí desaparecen de Library, Sessions,
  // Stats y las columnas de navegación de una sola vez.
  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      genres: gamesTable.genres,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  // Horas manuales por juego (ya vienen en horas, se suman directas). Agrupo
  // solo sobre iterations sin tocar sessions todavía — si mezclo las dos
  // tablas en un JOIN, esto se duplica una vez por cada sesión de la iteración.
  const manualHoursByGame = await db
    .select({
      gameId: iterationsTable.gameId,
      totalManualHours: sql<number>`coalesce(sum(${iterationsTable.manualTotalPlayed}), 0)`,
    })
    .from(iterationsTable)
    .groupBy(iterationsTable.gameId);

  const manualHoursMap = new Map(
    manualHoursByGame.map((row) => [row.gameId, row.totalManualHours]),
  );

  // Todas las sesiones del juego (vía sus iteraciones), sin agregar. De aquí
  // salen CUATRO cosas a la vez en el mismo bucle de abajo: horas trackeadas,
  // nº de sesiones, si hay alguna sesión abierta ahora mismo (LIVE), y desde
  // cuándo (para el contador en vivo de la card — SPEC 10.7 lo pide junto al
  // badge PLAYING, no basta con saber que está en marcha).
  const sessionRows = await db
    .select({
      gameId: iterationsTable.gameId,
      startedAt: sessionsTable.startedAt,
      durationSec: sessionsTable.durationSec,
      endedAt: sessionsTable.endedAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id));

  const trackedSecondsByGame = new Map<number, number>();
  const sessionCountByGame = new Map<number, number>();
  // startedAt de la sesión abierta del juego (SPEC 4.5: como mucho un
  // playthrough activo por juego, así que como mucho una sesión abierta).
  const liveSinceByGame = new Map<number, Date>();

  for (const row of sessionRows) {
    trackedSecondsByGame.set(
      row.gameId,
      (trackedSecondsByGame.get(row.gameId) ?? 0) + (row.durationSec ?? 0),
    );
    sessionCountByGame.set(row.gameId, (sessionCountByGame.get(row.gameId) ?? 0) + 1);
    if (row.endedAt === null) {
      liveSinceByGame.set(row.gameId, row.startedAt);
    }
  }

  // Todos los stateEvents del juego (vía sus iteraciones), sin agregar
  // todavía. El "estado actual" es otro caso de 1-fila-por-grupo (la más
  // reciente por gameId), así que lo resuelvo igual que las horas: traigo las
  // candidatas y me quedo con la mejor en JS. Nada de JOIN plano (repite
  // filas) ni ROW_NUMBER — para esto es matar moscas a cañonazos.
  const stateEventRows: StateEventCandidate[] = await db
    .select({
      gameId: iterationsTable.gameId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      id: stateEventsTable.id,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  // Recorro todas las candidatas y me quedo, por cada gameId, con la más
  // reciente vista hasta ese momento. El Map empieza vacío pero se va
  // llenando según avanza el bucle: la primera fila de un juego gana por
  // defecto (no hay nada con qué compararla), y las siguientes del MISMO
  // juego se comparan contra lo que dejó guardado una vuelta anterior.
  const latestStateEventByGame = new Map<number, StateEventCandidate>();

  for (const row of stateEventRows) {
    // 'plan_to_play' es solo una entrada de historial (ver schema.ts) — no
    // cuenta para el estado actual: un juego pasado del Plan a la biblioteca
    // como "jugado en el pasado" tiene su evento real (completed/...) con
    // fecha ANTERIOR al plan, y sin este filtro el plan ganaría siempre.
    if (row.type === 'plan_to_play') continue;
    const previousLatest = latestStateEventByGame.get(row.gameId);

    if (!previousLatest) {
      // Nada guardado todavía para este juego, así que esta fila gana directa.
      latestStateEventByGame.set(row.gameId, row);
      continue;
    }

    const rowIsNewer = row.occurredAt.getTime() > previousLatest.occurredAt.getTime();
    const rowIsSameDateButHigherId =
      row.occurredAt.getTime() === previousLatest.occurredAt.getTime() &&
      row.id > previousLatest.id;

    if (rowIsNewer || rowIsSameDateButHigherId) {
      latestStateEventByGame.set(row.gameId, row);
    }
  }

  return games.map((game) => {
    const manualHours = manualHoursMap.get(game.id) ?? 0;
    const trackedSeconds = trackedSecondsByGame.get(game.id) ?? 0;
    const trackedHours = trackedSeconds / 3600;

    const latestStateEvent = latestStateEventByGame.get(game.id);

    const liveSince = liveSinceByGame.get(game.id) ?? null;

    return {
      id: game.id,
      title: game.title,
      coverUrl: game.coverUrl,
      genres: game.genres,
      totalHours: manualHours + trackedHours,
      currentState: latestStateEvent?.type ?? null,
      isLive: liveSince !== null,
      liveSince,
      sessionCount: sessionCountByGame.get(game.id) ?? 0,
    };
  });
};
