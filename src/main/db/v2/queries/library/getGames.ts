import { and, asc, eq, isNull, not } from 'drizzle-orm';
import { deriveLibrary, type LibraryLiveSession } from '../../../../../shared/domain/library';
import type { GameListItem } from '../../../../../shared/types';
import { games, playthroughs, sessions, stateEvents } from '../../schema';
import { alive } from '../../store';
import { gameViewRows, toGameRow, viewPlan } from '../common/gameView';
import type { QueryContext } from '../common/context';
import { playthroughSessionTotals } from './playthroughTotals';
import { compareTitlesNocase, hasLivePlan } from './shared';

// LA LISTA DE LA BIBLIOTECA sobre el esquema 2.0 (sustituye a
// db/queries/games/getGames.ts). Alimenta media app: biblioteca, rail de
// navegación, Sessions, Stats y el hero del modo TV.
//
// Las REGLAS (horas, sesiones, estado, "Last played", en vivo, año de las
// horas manuales) son las de `deriveLibrary` (shared/domain/library.ts), las
// mismas que usa el Worker. Aquí solo se traen las filas, en TRES consultas
// que no crecen con el tamaño de la biblioteca (presupuestos.test.ts):
//
//   1. Los juegos de la biblioteca: la vista común del juego (valores
//      efectivos, ruta de ESTE PC) sin los que tienen `plan_entries` viva.
//   2. Una fila por playthrough vivo con sus sesiones vivas YA AGREGADAS
//      (`playthroughSessionTotals`): crece con los playthroughs, no con las
//      sesiones, que es lo que mantenía barata la 1.x.
//   3. El log de estados vivo, entero y sin agregar (deriveLibrary mira todo
//      el historial, no solo su última fila).
//
// Diferencias con la 1.x:
//   - "Planeado" = `plan_entries` viva (CONSULTAS.md §1.1.3), no una columna.
//   - Solo filas vivas, con la regla F-11: un playthrough con lápida se lleva
//     sus sesiones y eventos aunque estos sigan vivos (sync a medias), y un
//     juego con lápida, todo.
//   - El papeleo del alta es EXACTAMENTE `datePrecision = 'unknown'` (R-07):
//     `paperwork: 'datePrecision'`. Nunca la heurística de los 5 s sobre
//     filas 2.0: un evento real tecleado con hora en el mismo minuto del alta
//     cuenta.
//   - Orden de los playthroughs por creación (`syncCreated, id`).
//
// Sin juegos planeados: la sección del Plan es la ÚNICA que los ve
// (getPlannedGames). Al excluirlos aquí desaparecen de Library, Sessions,
// Stats y la navegación de una vez.

/** La biblioteca (juegos vivos sin entrada viva en el Plan), en orden alfabético. */
export function getGames(ctx: QueryContext): GameListItem<string>[] {
  const rows = gameViewRows(ctx, isNull(viewPlan.id));
  if (rows.length === 0) return [];

  // Vivos con F-11: el juego se une vivo en el INNER JOIN, así que basta
  // `alive()` en el playthrough (no hace falta el EXISTS de
  // `livePlaythrough`, que se pagaría por fila). Las sesiones van con su
  // condición en el ON del LEFT JOIN: su padre (el playthrough) ya está
  // filtrado vivo en esta misma consulta.
  //
  // El orden por creación es también el orden en que deriveLibrary suma las
  // horas (en coma flotante el orden puede cambiar el último bit): así no
  // tiene que reordenar.
  const iterations = ctx.db
    .select({
      id: playthroughs.id,
      gameId: playthroughs.gameId,
      manualTotalPlayed: playthroughs.manualHours,
      ...playthroughSessionTotals,
    })
    .from(playthroughs)
    .innerJoin(games, and(eq(games.id, playthroughs.gameId), alive(games)))
    .leftJoin(sessions, and(eq(sessions.playthroughId, playthroughs.id), alive(sessions)))
    .where(and(alive(playthroughs), not(hasLivePlan(games.id))))
    .groupBy(playthroughs.id)
    .orderBy(asc(playthroughs.syncCreated), asc(playthroughs.id))
    .all();

  // El log entero de los juegos de la biblioteca. Mismo razonamiento de vida:
  // juego y playthrough unidos vivos, el evento vivo. `datePrecision` viaja
  // porque con la regla 2.0 es lo único que distingue el papeleo del alta.
  const events = ctx.db
    .select({
      gameId: playthroughs.gameId,
      iterationId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
      id: stateEvents.id,
    })
    .from(stateEvents)
    .innerJoin(
      playthroughs,
      and(eq(playthroughs.id, stateEvents.playthroughId), alive(playthroughs)),
    )
    .innerJoin(games, and(eq(games.id, playthroughs.gameId), alive(games)))
    .where(and(alive(stateEvents), not(hasLivePlan(games.id))))
    .all();

  // En vivo: toda sesión abierta, de cualquier dispositivo (como hoy en el
  // escritorio). El arranque más reciente por playthrough ya viene agregado;
  // deriveLibrary elige entre los del juego.
  const liveSessions: LibraryLiveSession<string>[] = [];
  for (const row of iterations) {
    if (row.liveSince !== null) liveSessions.push({ gameId: row.gameId, startedAt: row.liveSince });
  }

  const summaries = deriveLibrary({
    games: rows,
    iterations,
    stateEvents: events,
    liveSessions,
    paperwork: 'datePrecision',
  });

  return rows
    .map((row): GameListItem<string> => {
      const game = toGameRow(row);
      // deriveLibrary devuelve un resumen para cada juego de `rows`.
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
    })
    .sort((a, b) => compareTitlesNocase(a.title, b.title));
}
