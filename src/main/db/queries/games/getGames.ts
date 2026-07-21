import { eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameListItem, StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import { latestRealStateEvent } from '../stateEvents/latestRealStateEvent';
import { resolveIterationHours } from './iterationHours';

// Forma de una fila candidata a "evento de estado más reciente de este
// juego". La nombro explícitamente en vez de inferirla del array para no
// tener que ir a buscar la query cada vez que quiera saber qué trae.
// iterationId: para derivar además el año de las horas manuales por
// playthrough (modelo v2 — la fecha de fin vive en el log de estados).
type StateEventCandidate = {
  gameId: number;
  iterationId: number;
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
      // Para la cara trasera de la card (flip) — una columna de texto más
      // por juego, nada al lado de lo que ya agrega esta query.
      heroUrl: gamesTable.heroUrl,
      genres: gamesTable.genres,
      isEmulated: gamesTable.isEmulated,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      hltbMain: gamesTable.hltbMain,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  // Iteraciones con su manualTotalPlayed — a nivel de ITERACIÓN, no ya
  // sumado por juego, porque las horas de cada iteración se resuelven igual
  // que en getGameById.ts: manualTotalPlayed reemplaza a lo trackeado en ESA
  // iteración (es un total de mano, no un extra encima), nunca se suman los
  // dos. Sumar ambos por separado (como hacía esto antes) inflaba el total
  // en cuanto una iteración con horas manuales tenía además alguna sesión
  // real — el bug real detrás de "meto un número y sale otro distinto".
  const iterations = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable);

  // Todas las sesiones del juego (vía sus iteraciones), sin agregar. De aquí
  // salen CUATRO cosas a la vez en el mismo bucle de abajo: horas trackeadas
  // (agrupadas por ITERACIÓN, para el reemplazo de arriba), nº de sesiones,
  // si hay alguna sesión abierta ahora mismo (LIVE), y desde cuándo (para el
  // contador en vivo de la card — SPEC 10.7 lo pide junto al badge PLAYING,
  // no basta con saber que está en marcha).
  const sessionRows = await db
    .select({
      id: sessionsTable.id,
      gameId: iterationsTable.gameId,
      // iterationsTable.id y no sessionsTable.iterationId — mismo valor bajo
      // el inner join, pero el tipo sale number (no nullable) sin guardas.
      iterationId: iterationsTable.id,
      startedAt: sessionsTable.startedAt,
      durationSec: sessionsTable.durationSec,
      endedAt: sessionsTable.endedAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id));

  const trackedSecondsByIteration = new Map<number, number>();
  const sessionCountByGame = new Map<number, number>();
  // startedAt de la sesión abierta del juego (SPEC 4.5: como mucho un
  // playthrough activo por juego, así que como mucho una sesión abierta).
  const liveSinceByGame = new Map<number, Date>();

  for (const row of sessionRows) {
    trackedSecondsByIteration.set(
      row.iterationId,
      (trackedSecondsByIteration.get(row.iterationId) ?? 0) + (row.durationSec ?? 0),
    );
    // Modelo v2: toda fila de sessions es tiempo jugado real — ya no existen
    // los marcadores de borde que antes había que descontar aquí.
    sessionCountByGame.set(row.gameId, (sessionCountByGame.get(row.gameId) ?? 0) + 1);
    if (row.endedAt === null) {
      liveSinceByGame.set(row.gameId, row.startedAt);
    }
  }

  // Horas por juego = suma de las horas de cada una de sus iteraciones,
  // cada una ya resuelta con la misma regla manual-o-trackeado-nunca-los-dos.
  const hoursByGame = new Map<number, number>();
  for (const iteration of iterations) {
    const trackedSeconds = trackedSecondsByIteration.get(iteration.id) ?? 0;
    const hours = resolveIterationHours(iteration.manualTotalPlayed, trackedSeconds);
    hoursByGame.set(iteration.gameId, (hoursByGame.get(iteration.gameId) ?? 0) + hours);
  }

  // Todos los stateEvents del juego (vía sus iteraciones), sin agregar
  // todavía. El "estado actual" es otro caso de 1-fila-por-grupo (la más
  // reciente por gameId), así que lo resuelvo igual que las horas: traigo las
  // candidatas y me quedo con la mejor en JS. Nada de JOIN plano (repite
  // filas) ni ROW_NUMBER — para esto es matar moscas a cañonazos.
  const stateEventRows: StateEventCandidate[] = await db
    .select({
      gameId: iterationsTable.gameId,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      id: stateEventsTable.id,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  // Playthroughs con horas manuales, con el año al que atribuirlas para las
  // vistas por año de Stats (modelo v2: la fecha sale del LOG de estados,
  // no de sesiones ancla): el año del último evento terminal del playthrough
  // (su fin), o el del primer 'started' si no terminó, o null sin fechas
  // (solo cuenta en All Time).
  const eventsByIteration = new Map<number, StateEventCandidate[]>();
  for (const row of stateEventRows) {
    const list = eventsByIteration.get(row.iterationId) ?? [];
    list.push(row);
    eventsByIteration.set(row.iterationId, list);
  }

  const manualIterationsByGame = new Map<
    number,
    { iterationId: number; hours: number; year: number | null }[]
  >();
  for (const iteration of iterations) {
    if (iteration.manualTotalPlayed === null) continue;
    const events = eventsByIteration.get(iteration.id) ?? [];
    let anchorDate: Date | null = null;
    for (const event of events) {
      const isTerminal =
        event.type === 'completed' || event.type === 'dropped' || event.type === 'on_hold';
      if (
        isTerminal &&
        (anchorDate === null || event.occurredAt.getTime() > anchorDate.getTime())
      ) {
        anchorDate = event.occurredAt;
      }
    }
    if (anchorDate === null) {
      for (const event of events) {
        if (
          event.type === 'started' &&
          (anchorDate === null || event.occurredAt.getTime() < anchorDate.getTime())
        ) {
          anchorDate = event.occurredAt;
        }
      }
    }
    const list = manualIterationsByGame.get(iteration.gameId) ?? [];
    list.push({
      iterationId: iteration.id,
      hours: iteration.manualTotalPlayed,
      year: anchorDate?.getFullYear() ?? null,
    });
    manualIterationsByGame.set(iteration.gameId, list);
  }

  // Agrupo las candidatas por gameId y le paso cada grupo al helper
  // compartido (ignora 'plan_to_play' — ver schema.ts — y desempata por id):
  // un juego pasado del Plan a la biblioteca como "jugado en el pasado"
  // tiene su evento real (completed/...) con fecha ANTERIOR al plan, y sin
  // ese filtro el plan ganaría siempre.
  const candidatesByGame = new Map<number, StateEventCandidate[]>();
  for (const row of stateEventRows) {
    const list = candidatesByGame.get(row.gameId) ?? [];
    list.push(row);
    candidatesByGame.set(row.gameId, list);
  }

  const latestStateEventByGame = new Map<number, StateEventCandidate>();
  for (const [gameId, candidates] of candidatesByGame) {
    const latest = latestRealStateEvent(candidates);
    if (latest) latestStateEventByGame.set(gameId, latest);
  }

  return games.map((game) => {
    const latestStateEvent = latestStateEventByGame.get(game.id);

    const liveSince = liveSinceByGame.get(game.id) ?? null;

    return {
      id: game.id,
      title: game.title,
      coverUrl: game.coverUrl,
      heroUrl: game.heroUrl,
      genres: game.genres,
      isEmulated: game.isEmulated,
      releaseYear: game.releaseYear,
      totalHours: hoursByGame.get(game.id) ?? 0,
      addedAt: game.addedAt,
      hltbMain: game.hltbMain,
      manualIterations: manualIterationsByGame.get(game.id) ?? [],
      currentState: latestStateEvent?.type ?? null,
      isLive: liveSince !== null,
      liveSince,
      sessionCount: sessionCountByGame.get(game.id) ?? 0,
    };
  });
};
