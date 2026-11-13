import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { externalChecks, gameMetadata, games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';

// `external:status` (`ipc/external.ts:19`): el estado de la tarjeta de datos
// externos de Ajustes. Puros COUNT, en una consulta, sobre juegos vivos ⟕
// caché ⟕ `ec(igdb_ratings)`.
//
// `running` no sale de la base: lo añade el handler con
// `isExternalRefreshRunning()`, como hoy.

/** `ExternalDataStatus` (`igdb/types.ts`) sin `running`. */
export interface ExternalDataCounts {
  readonly total: number;
  readonly withRatings: number;
  readonly withSummary: number;
  readonly withFullDate: number;
  /**
   * Sin respuesta de IGDB a las notas: sin `ec(igdb_ratings)` viva, o con un
   * fallo (en la 1.x un fallo no dejaba `ratingsCheckedAt`).
   */
  readonly neverChecked: number;
  readonly steamEligible: number;
  readonly withSteamData: number;
  readonly withHltb: number;
}

export function getExternalDataCounts(ctx: QueryContext): ExternalDataCounts {
  const md = gameMetadata;
  const ratings = alias(externalChecks, 'st_ec_ratings');
  const row = ctx.db
    .select({
      total: sql<number>`count(*)`,
      withRatings: sql<number>`count(*) filter (where ${md.ratingCritics} is not null or ${md.ratingUsers} is not null)`,
      withSummary: sql<number>`count(*) filter (where ${md.summary} is not null)`,
      withFullDate: sql<number>`count(*) filter (where ${md.releaseDate} is not null)`,
      neverChecked: sql<number>`count(*) filter (where ${ratings.id} is null or ${ratings.status} = 'error')`,
      steamEligible: sql<number>`count(*) filter (where ${games.steamAppId} is not null)`,
      withSteamData: sql<number>`count(*) filter (where ${md.steamTags} is not null or ${md.steamPositive} is not null)`,
      withHltb: sql<number>`count(*) filter (where ${md.hltbMain} is not null or ${md.hltbMainExtras} is not null or ${md.hltbCompletionist} is not null)`,
    })
    .from(games)
    .leftJoin(md, and(eq(md.gameId, games.id), alive(md)))
    .leftJoin(
      ratings,
      and(eq(ratings.gameId, games.id), eq(ratings.source, 'igdb_ratings'), alive(ratings)),
    )
    .where(alive(games))
    .get();
  return {
    total: Number(row?.total ?? 0),
    withRatings: Number(row?.withRatings ?? 0),
    withSummary: Number(row?.withSummary ?? 0),
    withFullDate: Number(row?.withFullDate ?? 0),
    neverChecked: Number(row?.neverChecked ?? 0),
    steamEligible: Number(row?.steamEligible ?? 0),
    withSteamData: Number(row?.withSteamData ?? 0),
    withHltb: Number(row?.withHltb ?? 0),
  };
}
