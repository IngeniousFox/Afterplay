import { isNotNull } from 'drizzle-orm';
import { planWaitingSince } from '../../../../../shared/domain/planOrder';
import type { PlannedGameExtras, PlannedGameListItem } from '../../../../../shared/types';
import { planEntries } from '../../schema';
import { livePlanEntry } from '../common/alive';
import type { QueryContext } from '../common/context';
import { gameViewRows, toGameRow, viewPlan } from '../common/gameView';
import { compareTitlesNocase } from './shared';

// LA SECCIÓN DEL PLAN sobre el esquema 2.0 (sustituye a
// db/queries/games/getPlannedGames.ts): la contrapartida de getGames, SOLO los
// juegos con `plan_entries` viva. Lo que un planeado no tiene por definición
// (horas, sesiones, estado real) va fijo a cero / `plan_to_play`.
//
// Mantiene los DOS CANALES de la 1.x (el porqué y las cifras están en
// shared/types.ts): `getPlannedGames` es el escueto que paga toda la app en
// cada 'games:changed', `getPlannedGameExtras` el que solo mira la pantalla
// del Plan. El renderer los junta por id.
//
// Lo que cambia con el 2.0:
//   - "Planeado" = entrada viva en `plan_entries`, no `games.planned`.
//   - La fecha de espera sale de `plan_entries.plannedAt`, no de una
//     subconsulta del primer evento `plan_to_play` (que ya no existe).
//     CAMBIO DE COMPORTAMIENTO (R-06): devolver un juego al Plan resucita la
//     entrada con un `plannedAt` NUEVO, así que vuelve a esperar desde ese
//     día. La 1.x conservaba la fecha de la PRIMERA entrada al Plan.
//   - La nota ("por qué lo planeo") es `plan_entries.note`: una por juego, sin
//     desempates entre varios `plan_to_play`.
//   - Carátula, banner, sinopsis, notas de crítica y Steam: valores efectivos
//     y caché de la vista común.
//
// Dos consultas por canal (la vista del juego y la entrada del Plan), fijas:
// no crecen con el número de planeados. La vista común no lleva `plannedAt`
// ni `note`, y repetir aquí su mapeo para ahorrar una consulta duplicaría la
// regla de los valores efectivos.

type PlanFields = { plannedAt: Date; note: string | null };

/** Las entradas vivas del Plan, por juego (id de la entrada = gameId). */
function livePlanFields(ctx: QueryContext): Map<string, PlanFields> {
  const rows = ctx.db
    .select({
      gameId: planEntries.gameId,
      plannedAt: planEntries.plannedAt,
      note: planEntries.note,
    })
    .from(planEntries)
    .where(livePlanEntry(planEntries))
    .all();
  return new Map(rows.map((row) => [row.gameId, { plannedAt: row.plannedAt, note: row.note }]));
}

/** El canal escueto: los juegos del Plan, en orden alfabético. */
export function getPlannedGames(ctx: QueryContext): PlannedGameListItem<string>[] {
  const rows = gameViewRows(ctx, isNotNull(viewPlan.id));
  if (rows.length === 0) return [];
  const plan = livePlanFields(ctx);

  return rows
    .map((row): PlannedGameListItem<string> => {
      const game = toGameRow(row);
      const plannedAt = plan.get(game.id)?.plannedAt ?? null;
      return {
        id: game.id,
        igdbId: game.igdbId,
        steamAppId: game.steamAppId,
        title: game.title,
        coverUrl: game.coverUrl,
        // SIEMPRE null en este canal, decisión medida de la 1.x (ningún
        // consumidor escueto lo pinta). El real viaja en los extras.
        heroUrl: null,
        genres: game.genres,
        isEmulated: game.isEmulated,
        endless: game.endless,
        releaseYear: game.releaseYear,
        totalHours: 0,
        // La regla es la compartida con el Worker (planOrder.ts). Las dos
        // consultas leen en la misma llamada síncrona: toda fila de la vista
        // tiene su entrada; el `?? null` (= el alta) es solo para el tipo.
        addedAt: new Date(planWaitingSince(game.addedAt.getTime(), plannedAt?.getTime() ?? null)),
        promotedAt: game.promotedAt,
        hltbMain: game.hltbMain,
        hltbMainExtras: game.hltbMainExtras,
        hltbCompletionist: game.hltbCompletionist,
        // Un planeado no se lanza desde el modo TV, que tampoco lo enseña.
        executablePath: null,
        manualIterations: [],
        currentState: 'plan_to_play',
        lastPlayedAt: null,
        isLive: false,
        liveSince: null,
        sessionCount: 0,
        planPinnedAt: game.planPinnedAt,
      };
    })
    .sort((a, b) => compareTitlesNocase(a.title, b.title));
}

/**
 * El otro canal: lo que solo mira la pantalla del Plan. Mismo conjunto de
 * juegos que `getPlannedGames` (cada id del escueto tiene aquí su fila). En
 * orden de creación del juego: el orden de presentación lo pone el escueto.
 */
export function getPlannedGameExtras(ctx: QueryContext): PlannedGameExtras<string>[] {
  const rows = gameViewRows(ctx, isNotNull(viewPlan.id));
  if (rows.length === 0) return [];
  const plan = livePlanFields(ctx);

  return rows.map((row): PlannedGameExtras<string> => {
    const game = toGameRow(row);
    return {
      id: game.id,
      heroUrl: game.heroUrl,
      summary: game.summary,
      planNote: plan.get(game.id)?.note ?? null,
      releaseDate: game.releaseDate,
      releaseDatePrecision: game.releaseDatePrecision,
      ratingCritics: game.ratingCritics,
      ratingCriticsCount: game.ratingCriticsCount,
      ratingUsers: game.ratingUsers,
      ratingUsersCount: game.ratingUsersCount,
      steamPositive: game.steamPositive,
      steamNegative: game.steamNegative,
      steamTags: game.steamTags,
    };
  });
}
