import { deriveMoments, type MemorySession } from '../../../../../shared/memory/moments';
import type { SessionsPage, SessionsPageRequest } from '../../../../../shared/types';
import type { QueryContext } from '../common';
import { getGames } from '../library';
import { countAllSessions, getAllSessions, getSessionDurationSummary } from '../sessions/read';
import { readStatsSessionRows } from './sessionStats';

// Una página de la vista de Sesiones (AFTERPLAY-2.0.md §15.6, F-41).
//
// El renderer pedía todas las sesiones para tres cosas: cortar la página, las
// dos cifras de cabecera (la más larga y la media) y los momentos señalados.
// Ahora la página, el total y las cifras salen del filtro en SQL, y los
// momentos se derivan aquí sobre la historia COMPLETA y se recortan a las
// sesiones de la página.

/**
 * Los momentos de la página. Se derivan con la misma regla de siempre
 * (`deriveMoments`) y sobre las mismas entradas que usaba la pantalla: todas
 * las sesiones —no solo las del filtro: "tu sesión más larga de Hollow Knight"
 * es la misma verdad se mire desde donde se mire— sin el reloj de creación (la
 * pantalla nunca lo tuvo, así que los empates se deshacen por id), y las horas
 * manuales de los playthroughs de la biblioteca como línea base de los hitos
 * de horas.
 */
function momentsOfPage(
  ctx: QueryContext,
  pageIds: ReadonlySet<string>,
): SessionsPage<string>['moments'] {
  const memorySessions: MemorySession<string>[] = readStatsSessionRows(ctx).map((row) => ({
    id: row.id,
    gameId: row.gameId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    isManual: row.isManual,
  }));
  const manualHoursByGame = new Map(
    getGames(ctx).map((game) => [
      game.id,
      game.manualIterations.reduce((sum, manual) => sum + manual.hours, 0),
    ]),
  );
  return deriveMoments(memorySessions, manualHoursByGame).filter((moment) =>
    pageIds.has(moment.sessionId),
  );
}

export function getSessionsPage(
  ctx: QueryContext,
  request: SessionsPageRequest<string>,
): SessionsPage<string> {
  const filter = request.gameId === null ? {} : { gameId: request.gameId };
  const page = Math.max(1, request.page);
  const items = getAllSessions(ctx, {
    ...filter,
    limit: request.pageSize,
    offset: (page - 1) * request.pageSize,
  });
  const { longestSec, avgSec } = getSessionDurationSummary(ctx, filter);
  return {
    page,
    items,
    total: countAllSessions(ctx, filter),
    longestSec,
    avgSec,
    moments: items.length === 0 ? [] : momentsOfPage(ctx, new Set(items.map((item) => item.id))),
  };
}
