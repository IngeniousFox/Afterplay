import { desc, eq } from 'drizzle-orm';
import { buildSessionStats, type SessionStats } from '../../../../../shared/domain/sessionStats';
import type { StatsSessionRow } from '../../../../../shared/domain/sessionStats';
import { games, playthroughs, sessions } from '../../schema';
import { liveSession, type QueryContext } from '../common';

// El resumen de sesiones de las Estadísticas (AFTERPLAY-2.0.md §15.6, F-41).
//
// El renderer ya no pide todas las sesiones para pintar Stats: el main las lee
// con las columnas mínimas (sin carátula ni nota) y las reduce con la regla
// compartida (`shared/domain/sessionStats`) a días, años y distribuciones. Lo
// que cruza el IPC es del orden de los días jugados, no de las sesiones.
//
// Las filas van en el orden de siempre de la lista de sesiones (más reciente
// primero; a igual inicio, la creada después primero): varios desempates de la
// regla ("gana el primero que aparece") dependen de él.

/** Las sesiones asignadas y vivas, con lo mínimo que usa el resumen. */
export function readStatsSessionRows(ctx: QueryContext): StatsSessionRow<string>[] {
  const rows = ctx.db
    .select({
      id: sessions.id,
      iterationId: playthroughs.id,
      gameId: games.id,
      gameTitle: games.title,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
      source: sessions.source,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    .where(liveSession())
    .orderBy(desc(sessions.startedAt), desc(sessions.syncCreated), desc(sessions.id))
    .all();
  return rows.map(({ source, ...row }) => ({ ...row, isManual: source === 'legacy_manual' }));
}

/** El resumen de sesiones de toda la biblioteca. `now` fija la ventana del ritmo reciente. */
export function getSessionStats(ctx: QueryContext, now: Date = ctx.now()): SessionStats<string> {
  return buildSessionStats(readStatsSessionRows(ctx), now);
}
