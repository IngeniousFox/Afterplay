import { eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import { latestRealStateEvent, manualHoursAnchor } from '../../../../shared/playthroughState';
import type { GameListItem, StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
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
      endless: gamesTable.endless,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      hltbMain: gamesTable.hltbMain,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  // Iteraciones con su manualTotalPlayed — a nivel de ITERACIÓN, no ya
  // sumado por juego, porque las horas de cada iteración se resuelven igual
  // que en getGameById.ts, vía el mismo resolveIterationHours compartido de
  // más abajo: manualTotalPlayed (jugado FUERA del tracking) se SUMA a lo
  // trackeado en ESA iteración, nunca lo reemplaza — son tiempos disjuntos
  // por definición. Ver iterationHours.ts para el porqué (reemplazar, no
  // sumar, era el bug real: un playthrough con horas manuales al que el
  // watcher le seguía colgando sesiones se quedaba clavado en el número
  // manual para siempre).
  const iterations = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable);

  // Todas las sesiones del juego (vía sus iteraciones), sin agregar. De aquí
  // salen CUATRO cosas a la vez en el mismo bucle de abajo: horas trackeadas
  // (agrupadas por ITERACIÓN, para sumarlas a las manuales), nº de sesiones,
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
  // Cuándo acabó la última sesión de cada juego — la base de "Last played".
  // Se toma endedAt y no startedAt para que una partida larga cuente por
  // cuándo se dejó, no por cuándo se empezó; en una sesión abierta (que aún
  // no tiene fin) el arranque ES lo más reciente que hay.
  const lastSessionByGame = new Map<number, Date>();

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

    const playedAt = row.endedAt ?? row.startedAt;
    const known = lastSessionByGame.get(row.gameId);
    if (!known || playedAt.getTime() > known.getTime()) {
      lastSessionByGame.set(row.gameId, playedAt);
    }
  }

  // Horas por juego = suma de las horas de cada una de sus iteraciones, cada
  // una ya resuelta con la misma regla de siempre (manual + trackeado).
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
  // vistas por año de Stats (modelo v2: la fecha sale del LOG de estados, no
  // de sesiones ancla). La regla de a qué fecha se cuelgan vive en
  // manualHoursAnchor, compartida con el Journey del renderer.
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
    const anchorDate = manualHoursAnchor(eventsByIteration.get(iteration.id) ?? []);
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

  // --- Respaldo de "Last played" cuando el juego no tiene sesiones ---
  //
  // Un evento de estado vale como "cuándo lo jugué" SOLO si su fecha la
  // pusiste tú. Al añadir un juego con estado pero sin fechas,
  // writeInitialPlaythrough deja que occurredAt caiga al $defaultFn del
  // schema, o sea AHORA: ese evento no dice cuándo lo jugaste, dice cuándo
  // lo diste de alta. Colarlo aquí convertía el orden en "los últimos que
  // añadí" disfrazado de "los últimos que jugué" — medido en la BD real: 6
  // juegos de 331, y los seis salían arriba del todo.
  //
  // Se reconocen porque su fecha coincide al segundo con el addedAt del
  // juego (mismo insert). Una fecha tecleada por ti nunca cae ahí: se
  // guarda a medianoche de ese día, a horas de distancia del alta.
  const ADDED_AT_TOLERANCE_MS = 5_000;
  const addedAtByGame = new Map(games.map((game) => [game.id, game.addedAt]));

  const lastEventByGame = new Map<number, Date>();
  for (const [gameId, candidates] of candidatesByGame) {
    const addedAt = addedAtByGame.get(gameId);
    for (const event of candidates) {
      // 'plan_to_play' fuera por lo mismo que en currentState: planear no es
      // jugar.
      if (event.type === 'plan_to_play') continue;
      if (
        addedAt &&
        Math.abs(event.occurredAt.getTime() - addedAt.getTime()) < ADDED_AT_TOLERANCE_MS
      ) {
        continue;
      }
      // Se mira TODO el log, no solo el último: si el evento más reciente es
      // uno de esos sin fecha propia pero un 'started' anterior sí la tiene,
      // esa fecha sigue siendo un dato bueno que no hay que tirar.
      const known = lastEventByGame.get(gameId);
      if (!known || event.occurredAt.getTime() > known.getTime()) {
        lastEventByGame.set(gameId, event.occurredAt);
      }
    }
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
      endless: game.endless,
      releaseYear: game.releaseYear,
      totalHours: hoursByGame.get(game.id) ?? 0,
      addedAt: game.addedAt,
      hltbMain: game.hltbMain,
      manualIterations: manualIterationsByGame.get(game.id) ?? [],
      currentState: latestStateEvent?.type ?? null,
      // Manda la sesión; si no hay ninguna, el último evento CON FECHA
      // PROPIA (ver arriba). Un juego que marcaste como completado sin
      // haberlo trackeado nunca SÍ se jugó — usar solo sesiones lo mandaría
      // al fondo junto a los que ni has tocado. null cuando no hay ni una
      // cosa ni la otra: es "no lo sé", y como tal se va al final de la
      // lista en vez de inventarse una fecha.
      lastPlayedAt: lastSessionByGame.get(game.id) ?? lastEventByGame.get(game.id) ?? null,
      isLive: liveSince !== null,
      liveSince,
      sessionCount: sessionCountByGame.get(game.id) ?? 0,
    };
  });
};
