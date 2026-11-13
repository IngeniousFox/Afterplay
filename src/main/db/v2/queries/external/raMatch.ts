import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { gameMetadata, games, playthroughs } from '../../schema';
import { alive } from '../../store';
import { livePlaythrough } from '../common/alive';
import { answeredAt, checkIsDue, clearCheck, readCheck } from '../common/checks';
import type { QueryContext } from '../common/context';
import { readLiveIdentity, recordCheck } from './internal';

// El emparejado con RetroAchievements (`ra/backfill.ts`): `raGameId` en
// `games` y su comprobación `ec(ra_match)`, que sustituye a `raCheckedAt`.
//
// La regla de la 1.x se conserva: ningún "no" de RA se graba en piedra. Un
// intento sin set (o con empate irresoluble) se apunta `empty` y vence a los 4
// días (`RA_REMATCH_AFTER_MS` en `CHECK_POLICIES`, copia de
// `REMATCH_AFTER_MS`). Un emparejado bueno es `ok` y no vence.
//
// Pasada de arranque (`runRaStartupPass`):
//   N1. Consolas nuevas en RA: `selectRaUnmatchedPlatforms` → el llamador
//       decide cuáles tocan una consola nueva → `forgetRaMatchChecks` (antes,
//       `raCheckedAt = null`).
//   N2. `selectRaMatchCandidates` → red (una lista por consola) y emparejado
//       en CPU fuera de la transacción → `readPlayedPlatforms` para los
//       empates → `applyRaMatchResults` (una transacción que relee). Si la
//       lista de una consola no se pudo bajar, ese juego NO se apunta (como
//       hoy): que lo reintente el siguiente arranque.
//   N3. `selectRaCatalogPending`: emparejados sin `ec(ra_achievements)` (o
//       vencida). Desaparece el atasco de la 1.x, donde una sola marca
//       (`achievementsSyncedAt`) servía para Steam y RA (MAPA nota 4).
// "Sync now" (`runRaFullResync`): `selectRaMatchedGames`.
// Botón de la ficha (`refreshRaForGame`): `readRaRefreshTarget` → red →
// `applyRaMatchResults([...])`.

/** Lo que el emparejado necesita de un juego (`MatchCandidate` de `ra/backfill.ts`). */
export interface RaMatchCandidate {
  readonly id: string;
  readonly title: string;
  readonly releaseYear: number | null;
  readonly officialPlatforms: string[] | null;
  /** Efectivo (override ?? caché): lo usan los avisos de `syncRaGame`. */
  readonly heroUrl: string | null;
}

const candidateFields = {
  id: games.id,
  title: games.title,
  releaseYear: gameMetadata.releaseYear,
  officialPlatforms: gameMetadata.officialPlatforms,
  heroOverride: games.heroOverride,
  mdHeroUrl: gameMetadata.heroUrl,
};

type CandidateRow = {
  id: string;
  title: string;
  releaseYear: number | null;
  officialPlatforms: string[] | null;
  heroOverride: string | null;
  mdHeroUrl: string | null;
};

const toCandidate = (row: CandidateRow): RaMatchCandidate => ({
  id: row.id,
  title: row.title,
  releaseYear: row.releaseYear,
  officialPlatforms: row.officialPlatforms,
  heroUrl: row.heroOverride ?? row.mdHeroUrl,
});

function selectCandidates(ctx: QueryContext, where: SQL | undefined): CandidateRow[] {
  return ctx.db
    .select(candidateFields)
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(and(alive(games), where))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
}

/** N2: vivos sin `raGameId` y con `ra_match` pendiente (nunca preguntado o vencido). */
export function selectRaMatchCandidates(ctx: QueryContext): RaMatchCandidate[] {
  return selectCandidates(ctx, and(isNull(games.raGameId), checkIsDue('ra_match', ctx.now()))).map(
    toCandidate,
  );
}

/** N1: las plataformas de los juegos vivos sin emparejar, para cruzarlas con las consolas nuevas. */
export function selectRaUnmatchedPlatforms(
  ctx: QueryContext,
): { readonly id: string; readonly officialPlatforms: string[] | null }[] {
  return selectCandidates(ctx, isNull(games.raGameId)).map((row) => ({
    id: row.id,
    officialPlatforms: row.officialPlatforms,
  }));
}

/**
 * N1: vuelve a dejar como "nunca preguntados" (lápida en `ec(ra_match)`) los
 * juegos que tocan una consola nueva, en una transacción. Devuelve cuántos.
 */
export function forgetRaMatchChecks(ctx: QueryContext, gameIds: readonly string[]): number {
  return ctx.store.transaction(() => {
    let forgotten = 0;
    for (const gameId of gameIds) {
      if (!readCheck(ctx, gameId, 'ra_match')) continue;
      clearCheck(ctx, gameId, 'ra_match');
      forgotten++;
    }
    return forgotten;
  });
}

/**
 * Las plataformas jugadas (la que apuntaste en cada playthrough vivo) de unos
 * juegos: la válvula de escape de los empates entre consolas
 * (`breakTieByPlayedPlatform`). Se pide solo para los empatados.
 */
export function readPlayedPlatforms(
  ctx: QueryContext,
  gameIds: readonly string[],
): Map<string, string[]> {
  const byGame = new Map<string, string[]>();
  if (gameIds.length === 0) return byGame;
  const rows = ctx.db
    .select({ gameId: playthroughs.gameId, playedPlatform: playthroughs.playedPlatform })
    .from(playthroughs)
    .where(and(inArray(playthroughs.gameId, [...new Set(gameIds)]), livePlaythrough()))
    .orderBy(asc(playthroughs.syncCreated), asc(playthroughs.id))
    .all();
  for (const row of rows) {
    const platforms = byGame.get(row.gameId);
    if (platforms) platforms.push(row.playedPlatform);
    else byGame.set(row.gameId, [row.playedPlatform]);
  }
  return byGame;
}

export interface RaMatchResult {
  readonly gameId: string;
  /** El set emparejado, o null: no está en RA o el empate no se pudo romper. */
  readonly raGameId: number | null;
}

export interface RaMatchApplied {
  readonly matched: number;
  readonly empty: number;
  /** Borrados, o que ya tenían `raGameId` (otro camino los emparejó durante la red). */
  readonly skipped: number;
}

/**
 * Apunta el emparejado de varios juegos en UNA transacción que relee cada uno:
 * vivo y todavía sin `raGameId`. Con set: `games.raGameId` + `ra_match` ok.
 * Sin set: `ra_match` empty (vence a los 4 días; re-preguntar lo mueve).
 */
export function applyRaMatchResults(
  ctx: QueryContext,
  results: readonly RaMatchResult[],
): RaMatchApplied {
  return ctx.store.transaction(() => {
    let matched = 0;
    let empty = 0;
    let skipped = 0;
    for (const result of results) {
      const current = readLiveIdentity(ctx, result.gameId);
      if (!current || current.raGameId !== null) {
        skipped++;
        continue;
      }
      if (result.raGameId === null) {
        recordCheck(ctx, current.id, 'ra_match', 'empty');
        empty++;
        continue;
      }
      ctx.store.patch('games', current.id, { raGameId: result.raGameId });
      recordCheck(ctx, current.id, 'ra_match', 'ok');
      matched++;
    }
    return { matched, empty, skipped };
  });
}

/** Lo que `refreshRaForGame` necesita de un juego. */
export interface RaRefreshTarget extends RaMatchCandidate {
  readonly raGameId: number | null;
  /**
   * ¿Se le preguntó ya a RA (con respuesta)? Es el `raCheckedAt !== null` de
   * la 1.x: un juego nunca preguntado siempre merece su intento; uno ya negado
   * solo con `forceRematch`. Un fallo no cuenta como preguntado (no dejaba sello).
   */
  readonly raMatchAsked: boolean;
}

/** null = el juego no existe o está borrado. */
export function readRaRefreshTarget(ctx: QueryContext, gameId: string): RaRefreshTarget | null {
  const [row] = selectCandidates(ctx, eq(games.id, gameId));
  if (!row) return null;
  const identity = readLiveIdentity(ctx, gameId);
  return {
    ...toCandidate(row),
    raGameId: identity?.raGameId ?? null,
    raMatchAsked: answeredAt(readCheck(ctx, gameId, 'ra_match')) !== null,
  };
}

/** Un juego emparejado, con lo que pide `syncRaGame`. */
export interface RaSyncTarget {
  readonly id: string;
  readonly title: string;
  readonly raGameId: number;
  readonly heroUrl: string | null;
}

function selectMatched(ctx: QueryContext, where: SQL | undefined): RaSyncTarget[] {
  const rows = ctx.db
    .select({
      id: games.id,
      title: games.title,
      raGameId: games.raGameId,
      heroOverride: games.heroOverride,
      mdHeroUrl: gameMetadata.heroUrl,
    })
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(and(alive(games), isNotNull(games.raGameId), where))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
  return rows.flatMap((row) =>
    row.raGameId === null
      ? []
      : [
          {
            id: row.id,
            title: row.title,
            raGameId: row.raGameId,
            heroUrl: row.heroOverride ?? row.mdHeroUrl,
          },
        ],
  );
}

/** "Sync now": todos los emparejados vivos. */
export function selectRaMatchedGames(ctx: QueryContext): RaSyncTarget[] {
  return selectMatched(ctx, undefined);
}

/** N3: emparejados cuyo catálogo de RA falta o tiene un fallo pendiente. */
export function selectRaCatalogPending(ctx: QueryContext): RaSyncTarget[] {
  return selectMatched(ctx, checkIsDue('ra_achievements', ctx.now()));
}
