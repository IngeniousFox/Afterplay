import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { AchievementsSourceStatus, AchievementsStatus } from '../../../../../shared/types';
import { achievementCatalogs, externalChecks, games, type AchievementSource } from '../../schema';
import { checkIsDue } from '../common/checks';
import { liveGame } from '../common/alive';
import type { QueryContext } from '../common/context';
import { gameViewRows, toGameRow } from '../common/gameView';
import { loadCatalogProgress, progressIsComplete, progressIsKnown } from './progress';

// La tarjeta de Ajustes y la lista de "a quién le toca sincronizar".

export interface AchievementsStatusOptions {
  readonly running: boolean;
  readonly failedGames: number;
  /** Lo que hoy se lee de `process.env` (credenciales): llega por parámetro (README). */
  readonly hasApiKey: boolean;
  readonly hasUserId: boolean;
  readonly hasRaCredentials: boolean;
}

// Los números de cada fuente (`AchievementsSourceStatus`) y el estado con
// `bySource` son los compartidos con ids de texto (shared/types.ts).
export type { AchievementsSourceStatus };

const CATALOG_CHECK = { steam: 'steam_achievements', ra: 'ra_achievements' } as const;

/**
 * Números de la tarjeta de Ajustes (getAchievementsStatus.ts), sobre juegos
 * vivos, planeados incluidos (la sincro los procesa igual):
 *
 * - `eligibleGames`: juegos con appid de Steam O set de RA, una vez cada uno.
 * - `syncedGames`: juegos con alguna fuente de catálogo respondida
 *   (`ec(steam_achievements)` o `ec(ra_achievements)` en `ok`/`empty`) o con
 *   algún catálogo vivo (lo importado puede no traer sello). Antes, el sello
 *   único `achievementsSyncedAt`.
 * - `totalAchievements`: suma de los catálogos vivos (`json_array_length`).
 * - `unlockedAchievements`: logros DISTINTOS que constan (los orígenes de un
 *   mismo logro cuentan uno) y que están en su catálogo.
 * - `bySource`: lo mismo por fuente, más los juegos al 100 % de cada una.
 *   Los totales de arriba son la suma de las dos fuentes (un juego con las
 *   dos cuenta una vez en `syncedGames`).
 */
export function getAchievementsStatus(
  ctx: QueryContext,
  options: AchievementsStatusOptions,
): AchievementsStatus<string> {
  const eligible = ctx.db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(games)
    .where(and(liveGame(), or(isNotNull(games.steamAppId), isNotNull(games.raGameId))))
    .get();

  // Juegos con catálogo respondido o con catálogo vivo, por fuente.
  const synced = new Map<AchievementSource, Set<string>>([
    ['steam', new Set()],
    ['ra', new Set()],
  ]);
  const answered = ctx.db
    .select({ gameId: externalChecks.gameId, source: externalChecks.source })
    .from(externalChecks)
    .innerJoin(games, eq(games.id, externalChecks.gameId))
    .where(
      and(
        // El juego ya se une: `alive` en las dos (README).
        sql`${externalChecks.syncDeleted} is null`,
        liveGame(),
        inArray(externalChecks.source, [CATALOG_CHECK.steam, CATALOG_CHECK.ra]),
        inArray(externalChecks.status, ['ok', 'empty']),
      ),
    )
    .all();
  for (const row of answered) {
    synced.get(row.source === CATALOG_CHECK.ra ? 'ra' : 'steam')?.add(row.gameId);
  }

  const progress = loadCatalogProgress(ctx);
  const bySource = { steam: emptySource(), ra: emptySource() };
  for (const p of progress) {
    synced.get(p.source)?.add(p.gameId);
    const target = bySource[p.source];
    target.totalAchievements += p.total;
    target.unlockedAchievements += p.unlocked.length;
    if (progressIsKnown(p) && progressIsComplete(p)) target.perfectGames++;
  }
  bySource.steam.syncedGames = synced.get('steam')?.size ?? 0;
  bySource.ra.syncedGames = synced.get('ra')?.size ?? 0;
  const syncedGames = new Set([...(synced.get('steam') ?? []), ...(synced.get('ra') ?? [])]).size;

  return {
    eligibleGames: eligible?.n ?? 0,
    syncedGames,
    totalAchievements: bySource.steam.totalAchievements + bySource.ra.totalAchievements,
    unlockedAchievements: bySource.steam.unlockedAchievements + bySource.ra.unlockedAchievements,
    running: options.running,
    hasApiKey: options.hasApiKey,
    hasUserId: options.hasUserId,
    hasRaCredentials: options.hasRaCredentials,
    failedGames: options.failedGames,
    bySource,
  };
}

const emptySource = (): AchievementsSourceStatus => ({
  syncedGames: 0,
  totalAchievements: 0,
  unlockedAchievements: 0,
  perfectGames: 0,
});

// ── Objetivos de la sincronización ─────────────────────────────────────────

/**
 * Un juego para la cola de Steam: la forma de `PendingAchievementsGame`
 * (steam/queue.ts) con ids de texto. Rutas de ESTE PC (`inst`) y hero
 * efectivo.
 */
export interface AchievementsSyncTarget {
  readonly id: string;
  readonly title: string;
  readonly steamAppId: number;
  readonly executablePath: string | null;
  readonly installDirectory: string | null;
  readonly heroUrl: string | null;
}

const toTarget = (row: Parameters<typeof toGameRow>[0]): AchievementsSyncTarget | null => {
  const game = toGameRow(row);
  return game.steamAppId === null
    ? null
    : {
        id: game.id,
        title: game.title,
        steamAppId: game.steamAppId,
        executablePath: game.executablePath,
        installDirectory: game.installDirectory,
        heroUrl: game.heroUrl,
      };
};

/** Orden por título sin mayúsculas, como el `collate nocase` de hoy. */
const byTitle = (a: AchievementsSyncTarget, b: AchievementsSyncTarget): number => {
  const x = a.title.toLowerCase();
  const y = b.title.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * A qué juegos les toca traer el catálogo de Steam
 * (getPendingAchievementsGames.ts). Solo con appid; planeados incluidos.
 *
 * - `full = false` (pasada del arranque): los que tienen pendiente
 *   `steam_achievements` (sin fila, o vencida: un fallo se reintenta). Antes
 *   miraba `achievementsSyncedAt`, que también estampaba RA: un juego con set
 *   de RA ya sincronizado nunca traía su catálogo de Steam (el "RA -> Steam"
 *   de ra/backfill.ts:387-400). Ahora cada fuente tiene su sello.
 * - `full = true` ("Sync now"): todos los que tienen appid.
 */
export function getPendingAchievementsGames(
  ctx: QueryContext,
  full: boolean,
): AchievementsSyncTarget[] {
  const where = full
    ? isNotNull(games.steamAppId)
    : and(isNotNull(games.steamAppId), checkIsDue('steam_achievements', ctx.now()));
  return gameViewRows(ctx, where)
    .flatMap((row) => toTarget(row) ?? [])
    .sort(byTitle);
}

/** El juego para encolar su refresco tras una sesión (backfill.ts:148), o null sin appid. */
export function getAchievementsRefreshTarget(
  ctx: QueryContext,
  gameId: string,
): AchievementsSyncTarget | null {
  const [row] = gameViewRows(ctx, and(eq(games.id, gameId), isNotNull(games.steamAppId)));
  return row ? toTarget(row) : null;
}

/**
 * Los juegos cuyos desbloqueos de emulador se recogen (barrido del arranque,
 * backfill.ts:93, y vigilante en vivo, emu/watcher.ts:58): con appid y con
 * catálogo de Steam vivo (sin catálogo no hay dónde colgar nada; antes,
 * `achievementsSyncedAt` puesto). TODAS las filas con ese appid, no la
 * primera (juego y edición pueden compartirlo). Con `appIds`, solo esos.
 */
export function getEmuUnlockTargets(
  ctx: QueryContext,
  appIds?: readonly number[],
): AchievementsSyncTarget[] {
  if (appIds && appIds.length === 0) return [];
  const hasCatalog = sql`exists (select 1 from ${achievementCatalogs} where ${and(
    eq(achievementCatalogs.gameId, games.id),
    eq(achievementCatalogs.source, 'steam'),
    sql`${achievementCatalogs.syncDeleted} is null`,
  )})`;
  const where = and(
    isNotNull(games.steamAppId),
    hasCatalog,
    appIds ? inArray(games.steamAppId, [...new Set(appIds)]) : undefined,
  );
  return gameViewRows(ctx, where).flatMap((row) => toTarget(row) ?? []);
}

/** Los juegos del sondeo en vivo de Steam (livePoll.ts:52): los que corren y tienen appid. */
export function getSteamLivePollGames(
  ctx: QueryContext,
  gameIds: readonly string[],
): AchievementsSyncTarget[] {
  if (gameIds.length === 0) return [];
  return gameViewRows(
    ctx,
    and(inArray(games.id, [...new Set(gameIds)]), isNotNull(games.steamAppId)),
  ).flatMap((row) => toTarget(row) ?? []);
}

/** Un juego emparejado con un set de RetroAchievements (ra/livePoll.ts, ra/backfill.ts). */
export interface RaMatchedGame {
  readonly id: string;
  readonly title: string;
  readonly raGameId: number;
  readonly heroUrl: string | null;
}

/**
 * Los juegos vivos emparejados con RA (con `raGameIds`, solo esos sets; con
 * `pendingOnly`, solo los que tienen pendiente `ra_achievements`).
 * TODAS las fichas de un mismo set, no la primera: `raGameId` no es único y
 * el estado en vivo tiene que coincidir con el de después de reiniciar
 * (raLivePoll.test.ts).
 */
export function getRaMatchedGames(
  ctx: QueryContext,
  raGameIds?: readonly number[],
  options: { readonly pendingOnly?: boolean } = {},
): RaMatchedGame[] {
  if (raGameIds && raGameIds.length === 0) return [];
  const where = and(
    isNotNull(games.raGameId),
    raGameIds ? inArray(games.raGameId, [...new Set(raGameIds)]) : undefined,
    // El nivel 3 del arranque de RA (ra/backfill.ts:405-425): emparejados sin
    // catálogo traído. Antes, `achievementsSyncedAt IS NULL`, que también
    // estampaba Steam; ahora el sello propio de RA (un fallo se reintenta).
    options.pendingOnly ? checkIsDue('ra_achievements', ctx.now()) : undefined,
  );
  return gameViewRows(ctx, where).flatMap((row) => {
    const game = toGameRow(row);
    return game.raGameId === null
      ? []
      : [{ id: game.id, title: game.title, raGameId: game.raGameId, heroUrl: game.heroUrl }];
  });
}
