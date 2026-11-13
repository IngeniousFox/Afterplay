import { and, asc, isNotNull } from 'drizzle-orm';
import { games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import { readLiveIdentity } from './internal';
import { applyIgdbBatch } from './refreshPass';
import type { IgdbBatchData } from './types';

// Fase 1 del radar semanal (`radar/pass.ts:105`, `refreshMembership`), solo la
// parte que toca `games`: refrescar la pertenencia a sagas (y de paso notas,
// sinopsis y fechas) de toda la biblioteca con el MISMO lote de IGDB que la
// pasada de biblioteca, y guardarlo igual (`applyIgdbBatch`, que es la
// sucesora de `buildIgdbBatchPatch`).
//
//   1. `selectRadarMembershipTargets` (antes, la adopción y el relleno de SGDB
//      del llamador, con sus propias consultas: `adoptIgdb.ts`,
//      `sgdbBackfill.ts`).
//   2. Red: `getGameExternalBatch(igdbIds)`.
//   3. `applyRadarMembership`: una transacción que relee el igdbId de cada
//      juego. Los que IGDB no devolvió se saltan (no se apuntan): su sello lo
//      pone la pasada de biblioteca que el radar lanza justo después, como hoy.
//
// El conjunto de colecciones lo calcula el llamador con lo que trajo la red;
// la escritura de `radar_games` (`findAnnounced`) es de P8.

export interface RadarMembershipTarget {
  readonly gameId: string;
  readonly igdbId: number;
}

/** Juegos vivos con igdbId: el radar va de sagas de IGDB. */
export function selectRadarMembershipTargets(ctx: QueryContext): RadarMembershipTarget[] {
  const rows = ctx.db
    .select({ gameId: games.id, igdbId: games.igdbId })
    .from(games)
    .where(and(alive(games), isNotNull(games.igdbId)))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
  return rows.filter((row): row is RadarMembershipTarget => row.igdbId !== null);
}

/** Devuelve cuántos juegos recibieron sus datos (vivos y con el mismo igdbId). */
export function applyRadarMembership(
  ctx: QueryContext,
  targets: readonly RadarMembershipTarget[],
  byIgdbId: ReadonlyMap<number, IgdbBatchData>,
): number {
  return ctx.store.transaction(() => {
    let applied = 0;
    for (const target of targets) {
      const data = byIgdbId.get(target.igdbId);
      if (!data) continue;
      const current = readLiveIdentity(ctx, target.gameId);
      if (!current || current.igdbId !== target.igdbId) continue;
      applyIgdbBatch(ctx, current, data);
      applied++;
    }
    return applied;
  });
}
