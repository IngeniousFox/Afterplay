import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import { deriveLibrary, type LibraryLiveSession } from '../../../../shared/domain/library';
import type { GameListItem } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import { iterationSessionTotals } from './iterationHours';

// La lista de la biblioteca. Las REGLAS (horas, sesiones, estado, "Last
// played", en vivo, el año de las horas manuales) viven en
// src/shared/domain/library.ts (deriveLibrary), compartidas con el Worker
// (AFTERPLAY-2.0.md §15.2, F-26). Aquí solo se traen las filas y se monta la
// respuesta.
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
      igdbId: gamesTable.igdbId,
      // Para que el buscador de Add Game reconozca los juegos que solo existen
      // en Steam — los que tienen igdbId null y que el cruce por IGDB no puede
      // ver (ver GameListItem.steamAppId).
      steamAppId: gamesTable.steamAppId,
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
      promotedAt: gamesTable.promotedAt,
      hltbMain: gamesTable.hltbMain,
      // Los otros dos tramos de HLTB viajan también: el overlay in-game
      // pinta la misma barra de tres tramos que la card de la ficha, y esta
      // lista es su única fuente de datos (OVERLAY.md §8.2).
      hltbMainExtras: gamesTable.hltbMainExtras,
      hltbCompletionist: gamesTable.hltbCompletionist,
      // Para el botón Play del modo TV (BIG-PICTURE.md §5.1): el hero de
      // TvHome lanza sin pasar por la ficha, y la lista era el único sitio
      // donde la ruta no viajaba.
      executablePath: gamesTable.executablePath,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  if (games.length === 0) return [];

  // Una fila por PLAYTHROUGH con sus sesiones YA AGREGADAS
  // (iterationSessionTotals, la misma definición que usa el Worker). Agregar
  // en SQL y no en JS es lo que hace que esta consulta —que corre en CADA
  // 'games:changed', o sea cada vez que el watcher abre o cierra una sesión—
  // no crezca con el historial: medido sobre una copia de la base real con
  // cinco años de tracking simulados (5.098 sesiones), traerse las filas
  // crudas costaba 16,7 ms de los 37,4 de getGames; agregadas, 4,0 ms sobre
  // 336 filas. LEFT JOIN conserva los playthroughs sin sesiones; el índice
  // sessions_iteration_idx evita reconstruir un índice automático.
  //
  // SOLO los de la biblioteca, igual que la lista de arriba: dos tercios de la
  // tabla eran de juegos planeados (661 de 997 filas en la base real) cuyo
  // gameId no aparece en `games`. El `order by id` mantiene el orden en que
  // deriveLibrary suma las horas: en coma flotante el orden puede cambiar el
  // último bit (deriveLibrary lo comprueba, pero así no tiene que ordenar).
  const iterations = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
      ...iterationSessionTotals,
    })
    .from(iterationsTable)
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .leftJoin(sessionsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(eq(gamesTable.planned, false))
    .groupBy(iterationsTable.id)
    .orderBy(asc(iterationsTable.id));

  // El log de estados de los juegos de la biblioteca, ENTERO y sin agregar:
  // de estas filas salen tres derivaciones —el estado actual, el respaldo de
  // "Last played" y el año de las horas manuales— y las dos últimas miran
  // TODO el historial, no solo su última fila, descartando antes los
  // artefactos del alta (una regla de src/shared, no de SQLite). Sin el log
  // de los planeados: 661 de 1.236 filas en la base real que nadie leía.
  const stateEvents = await db
    .select({
      gameId: iterationsTable.gameId,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      id: stateEventsTable.id,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(eq(gamesTable.planned, false));

  // En vivo: en el escritorio toda sesión abierta lo está, porque el watcher
  // barre en cada ciclo las de cronómetro rancias (sweepStaleTimerSessions).
  // El arranque más reciente de las abiertas de cada playthrough ya viene del
  // agregado (liveSince); deriveLibrary elige entre playthroughs.
  const liveSessions: LibraryLiveSession[] = [];
  for (const row of iterations) {
    if (row.liveSince !== null) liveSessions.push({ gameId: row.gameId, startedAt: row.liveSince });
  }

  const summaries = deriveLibrary({ games, iterations, stateEvents, liveSessions });

  return games.map((game) => {
    // deriveLibrary devuelve un resumen para cada juego de `games`.
    const summary = summaries.get(game.id)!;
    return {
      id: game.id,
      igdbId: game.igdbId,
      steamAppId: game.steamAppId,
      title: game.title,
      coverUrl: game.coverUrl,
      heroUrl: game.heroUrl,
      genres: game.genres,
      isEmulated: game.isEmulated,
      endless: game.endless,
      releaseYear: game.releaseYear,
      totalHours: summary.totalHours,
      addedAt: game.addedAt,
      promotedAt: game.promotedAt,
      hltbMain: game.hltbMain,
      hltbMainExtras: game.hltbMainExtras,
      hltbCompletionist: game.hltbCompletionist,
      executablePath: game.executablePath,
      manualIterations: summary.manualIterations,
      currentState: summary.currentState,
      lastPlayedAt: summary.lastPlayedAt,
      isLive: summary.isLive,
      liveSince: summary.liveSince,
      sessionCount: summary.sessionCount,
    };
  });
};
