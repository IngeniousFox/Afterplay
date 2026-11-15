import { and, eq, gte, lt } from 'drizzle-orm';
import { deriveStatsSummary, type StatsSummary } from '../../../../../shared/domain/statsSummary';
import { yearOf } from '../../../../../shared/yearOf';
import { games, playthroughs, sessions } from '../../schema';
import { liveSession, type QueryContext } from '../common';
import { getGames } from './getGames';

// El resumen de estadísticas de la portada del móvil (F-26). Las reglas viven
// en `deriveStatsSummary` (shared/domain); aquí solo se traen las filas: la
// biblioteca (`getGames`) y las sesiones cuyo inicio puede caer en el año en
// curso. La ventana lleva dos días de margen a cada lado para cubrir cualquier
// zona horaria; el reparto exacto por año lo hace la regla compartida con
// `timeZone`.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatsSummaryOptions {
  /** Zona IANA de quien mira (el año se lee en su reloj). Sin ella, la del proceso. */
  readonly timeZone?: string | null;
}

export function getStatsSummary(
  ctx: QueryContext,
  options: StatsSummaryOptions = {},
): StatsSummary<string> {
  const now = ctx.now();
  const year = yearOf(now, options.timeZone);
  const library = getGames(ctx);

  const from = new Date(Date.UTC(year, 0, 1) - 2 * DAY_MS);
  const to = new Date(Date.UTC(year + 1, 0, 1) + 2 * DAY_MS);
  const yearSessions = ctx.db
    .select({
      gameId: playthroughs.gameId,
      startedAt: sessions.startedAt,
      durationSec: sessions.durationSec,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    .where(and(liveSession(), gte(sessions.startedAt, from), lt(sessions.startedAt, to)))
    .all();

  return deriveStatsSummary({
    games: library,
    sessions: yearSessions,
    now,
    timeZone: options.timeZone,
  });
}
