import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { GameRow } from '../../../../../shared/dto';
import {
  externalChecks,
  gameCuriosities,
  gameInstalls,
  gameMetadata,
  games,
  planEntries,
  type ExternalCheckSource,
} from '../../schema';
import { alive } from '../../store';
import { answeredAt } from './checks';
import type { QueryContext } from './context';

// "Un juego tal como lo ve la app" (CONSULTAS.md §1.2, `GameRow`).
//
// En la 1.x era una fila de `games`. En la 2.0 está repartido: identidad y
// decisiones del usuario en `games`, la caché externa en `game_metadata`, las
// rutas de ESTE PC en `game_installs`, el plan en `plan_entries`, los sellos
// en `external_checks` y la fecha de las curiosidades en `game_curiosities`.
// Esto lo junta en UNA consulta (uniones por clave, sin N+1) y lo mapea al
// DTO campo a campo:
//
// - Valor efectivo (D-22) en carátula, banner, desarrollador, distribuidora y
//   géneros: el override del usuario si existe, si no el de la caché.
// - `planned` = existe `plan_entries` viva; `planPinnedAt` sale de ella.
// - Rutas = la instalación de este dispositivo; sin ella, null en este PC.
// - `steamAppIdManual` = `steamAppIdSource === 'manual'`.
// - Los sellos que el DTO aún conserva (`…CheckedAt`, `achievements…SyncedAt`)
//   salen de `external_checks` mientras P9 no los quite (decisión "DTO" de
//   §5.0). Ninguno lo lee el renderer.
//
// Solo juegos vivos. Las tablas unidas también solo cuentan vivas: una caché,
// una instalación o un plan con lápida es lo mismo que no tenerlos.

// Alias propios: así una consulta que reutilice `gameViewRows` con un `where`
// puede nombrar las tablas unidas sin chocar con las suyas.
export const viewMetadata = alias(gameMetadata, 'gv_md');
export const viewInstall = alias(gameInstalls, 'gv_inst');
export const viewPlan = alias(planEntries, 'gv_plan');
export const viewCuriosities = alias(gameCuriosities, 'gv_cur');

// Las fuentes cuyos sellos viajan todavía en `GameRow`, una unión por fuente.
const viewChecks = {
  steam_appid: alias(externalChecks, 'gv_ec_steam_appid'),
  steam_achievements: alias(externalChecks, 'gv_ec_steam_achievements'),
  ra_achievements: alias(externalChecks, 'gv_ec_ra_achievements'),
  steam_unlocks: alias(externalChecks, 'gv_ec_steam_unlocks'),
  ra_match: alias(externalChecks, 'gv_ec_ra_match'),
  igdb_ratings: alias(externalChecks, 'gv_ec_igdb_ratings'),
  steam_store: alias(externalChecks, 'gv_ec_steam_store'),
} satisfies { readonly [S in ExternalCheckSource]?: unknown };
type Stamped = keyof typeof viewChecks;

const md = viewMetadata;
const inst = viewInstall;
const plan = viewPlan;
const cur = viewCuriosities;
const ec = viewChecks;

// Proyección explícita (como `projections.ts` en la 1.x): con `select()` a
// secas sobre tantas uniones la inferencia de Drizzle se encarece y se vuelve
// frágil.
const GAME_VIEW_FIELDS = {
  id: games.id,
  title: games.title,
  igdbId: games.igdbId,
  steamAppId: games.steamAppId,
  steamAppIdSource: games.steamAppIdSource,
  raGameId: games.raGameId,
  sgdbId: games.sgdbId,
  coverOverride: games.coverOverride,
  heroOverride: games.heroOverride,
  developerOverride: games.developerOverride,
  publisherOverride: games.publisherOverride,
  genresOverride: games.genresOverride,
  notes: games.notes,
  endless: games.endless,
  isEmulated: games.isEmulated,
  addedAt: games.addedAt,
  promotedAt: games.promotedAt,
  saveBackupEnabled: games.saveBackupEnabled,
  saveDetectionSource: games.saveDetectionSource,
  saveLudusaviName: games.saveLudusaviName,
  saveCustomPaths: games.saveCustomPaths,
  saveKey: games.saveKey,

  mdCoverUrl: md.coverUrl,
  mdHeroUrl: md.heroUrl,
  mdDeveloper: md.developer,
  mdPublisher: md.publisher,
  mdGenres: md.genres,
  officialPlatforms: md.officialPlatforms,
  releaseYear: md.releaseYear,
  releaseDate: md.releaseDate,
  releaseDatePrecision: md.releaseDatePrecision,
  summary: md.summary,
  igdbCollections: md.igdbCollections,
  hltbMain: md.hltbMain,
  hltbMainExtras: md.hltbMainExtras,
  hltbCompletionist: md.hltbCompletionist,
  ratingCritics: md.ratingCritics,
  ratingCriticsCount: md.ratingCriticsCount,
  ratingUsers: md.ratingUsers,
  ratingUsersCount: md.ratingUsersCount,
  steamTags: md.steamTags,
  steamPositive: md.steamPositive,
  steamNegative: md.steamNegative,

  executablePath: inst.executablePath,
  installDirectory: inst.installDirectory,
  installSizeBytes: inst.installSizeBytes,

  planId: plan.id,
  planPinnedAt: plan.pinnedAt,

  curiositiesGeneratedAt: cur.generatedAt,

  steamAppIdCheckStatus: ec.steam_appid.status,
  steamAppIdCheckedAt: ec.steam_appid.checkedAt,
  steamAchievementsStatus: ec.steam_achievements.status,
  steamAchievementsCheckedAt: ec.steam_achievements.checkedAt,
  raAchievementsStatus: ec.ra_achievements.status,
  raAchievementsCheckedAt: ec.ra_achievements.checkedAt,
  steamUnlocksStatus: ec.steam_unlocks.status,
  steamUnlocksCheckedAt: ec.steam_unlocks.checkedAt,
  raMatchStatus: ec.ra_match.status,
  raMatchCheckedAt: ec.ra_match.checkedAt,
  ratingsStatus: ec.igdb_ratings.status,
  ratingsCheckedAt: ec.igdb_ratings.checkedAt,
  steamStoreStatus: ec.steam_store.status,
  steamStoreCheckedAt: ec.steam_store.checkedAt,
};

/** Una fila de la vista, antes de mapearla al DTO. */
export type GameViewRow = ReturnType<typeof selectGameView>[number];

// El tipo de vuelta es el que infiere Drizzle de la proyección y las uniones
// (con las columnas de las tablas unidas a null): escribirlo a mano duplicaría
// sus tipos internos y se separaría en silencio de GAME_VIEW_FIELDS.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function selectGameView(ctx: QueryContext, where: SQL | undefined) {
  const checkJoin = (source: Stamped): SQL | undefined =>
    and(eq(ec[source].gameId, games.id), eq(ec[source].source, source), alive(ec[source]));
  return ctx.db
    .select(GAME_VIEW_FIELDS)
    .from(games)
    .leftJoin(md, and(eq(md.gameId, games.id), alive(md)))
    .leftJoin(inst, and(eq(inst.gameId, games.id), eq(inst.deviceId, ctx.deviceId), alive(inst)))
    .leftJoin(plan, and(eq(plan.gameId, games.id), alive(plan)))
    .leftJoin(cur, and(eq(cur.gameId, games.id), alive(cur)))
    .leftJoin(ec.steam_appid, checkJoin('steam_appid'))
    .leftJoin(ec.steam_achievements, checkJoin('steam_achievements'))
    .leftJoin(ec.ra_achievements, checkJoin('ra_achievements'))
    .leftJoin(ec.steam_unlocks, checkJoin('steam_unlocks'))
    .leftJoin(ec.ra_match, checkJoin('ra_match'))
    .leftJoin(ec.igdb_ratings, checkJoin('igdb_ratings'))
    .leftJoin(ec.steam_store, checkJoin('steam_store'))
    .where(and(alive(games), where))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
}

/**
 * Las filas de la vista de los juegos vivos que cumplan `where` (todos si se
 * omite), en orden de creación. `where` puede nombrar `games` y las tablas
 * unidas por su alias exportado: `isNull(viewPlan.id)` = no planeados,
 * `isNotNull(viewInstall.executablePath)` = con ejecutable en este PC.
 */
export function gameViewRows(ctx: QueryContext, where?: SQL): GameViewRow[] {
  return selectGameView(ctx, where);
}

const latest = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : a.getTime() >= b.getTime() ? a : b;

const stamp = (status: GameViewRow['ratingsStatus'], checkedAt: Date | null): Date | null =>
  answeredAt({ status, checkedAt });

/** El mapeo campo a campo de §1.2. */
export function toGameRow(row: GameViewRow): GameRow<string> {
  return {
    id: row.id,
    title: row.title,
    coverUrl: row.coverOverride ?? row.mdCoverUrl,
    heroUrl: row.heroOverride ?? row.mdHeroUrl,
    igdbId: row.igdbId,
    steamGridDbId: row.sgdbId,
    officialPlatforms: row.officialPlatforms,
    releaseYear: row.releaseYear,
    hltbMain: row.hltbMain,
    hltbMainExtras: row.hltbMainExtras,
    hltbCompletionist: row.hltbCompletionist,
    notes: row.notes,
    executablePath: row.executablePath,
    developer: row.developerOverride ?? row.mdDeveloper,
    publisher: row.publisherOverride ?? row.mdPublisher,
    installDirectory: row.installDirectory,
    installSizeBytes: row.installSizeBytes,
    genres: row.genresOverride ?? row.mdGenres,
    endless: row.endless,
    isEmulated: row.isEmulated,
    planned: row.planId !== null,
    addedAt: row.addedAt,
    promotedAt: row.promotedAt,
    saveBackupEnabled: row.saveBackupEnabled,
    saveDetectionSource: row.saveDetectionSource,
    saveLudusaviName: row.saveLudusaviName,
    saveCustomPaths: row.saveCustomPaths,
    curiositiesGeneratedAt: row.curiositiesGeneratedAt,
    steamAppId: row.steamAppId,
    steamAppIdManual: row.steamAppIdSource === 'manual',
    steamAppIdCheckedAt: stamp(row.steamAppIdCheckStatus, row.steamAppIdCheckedAt),
    // Hoy lo escriben las dos fuentes (MAPA-1X nota 4): la más reciente.
    achievementsSyncedAt: latest(
      stamp(row.steamAchievementsStatus, row.steamAchievementsCheckedAt),
      stamp(row.raAchievementsStatus, row.raAchievementsCheckedAt),
    ),
    // Fuente nueva `steam_unlocks` (R-05) y también `ra_achievements`: en RA
    // los desbloqueos llegan con el catálogo, y la 1.x estampaba las dos
    // marcas a la vez (ra/sync.ts:67). La más reciente de las dos.
    achievementsUnlocksSyncedAt: latest(
      stamp(row.steamUnlocksStatus, row.steamUnlocksCheckedAt),
      stamp(row.raAchievementsStatus, row.raAchievementsCheckedAt),
    ),
    raGameId: row.raGameId,
    raCheckedAt: stamp(row.raMatchStatus, row.raMatchCheckedAt),
    ratingCritics: row.ratingCritics,
    ratingCriticsCount: row.ratingCriticsCount,
    ratingUsers: row.ratingUsers,
    ratingUsersCount: row.ratingUsersCount,
    ratingsCheckedAt: stamp(row.ratingsStatus, row.ratingsCheckedAt),
    summary: row.summary,
    igdbCollections: row.igdbCollections,
    steamTags: row.steamTags,
    steamPositive: row.steamPositive,
    steamNegative: row.steamNegative,
    steamSpyCheckedAt: stamp(row.steamStoreStatus, row.steamStoreCheckedAt),
    planPinnedAt: row.planPinnedAt,
    releaseDate: row.releaseDate,
    releaseDatePrecision: row.releaseDatePrecision,
  };
}

/** Un juego vivo como `GameRow`, o null si no existe o tiene lápida. */
export function readGameRow(ctx: QueryContext, gameId: string): GameRow<string> | null {
  const [row] = gameViewRows(ctx, eq(games.id, gameId));
  return row ? toGameRow(row) : null;
}

/**
 * Varios juegos como `GameRow`, en una consulta. Sin `gameIds`, todos los
 * vivos; con ellos, solo esos (los que no existan o tengan lápida no salen).
 * Orden de creación.
 */
export function readGameRows(ctx: QueryContext, gameIds?: readonly string[]): GameRow<string>[] {
  if (gameIds && gameIds.length === 0) return [];
  const where = gameIds ? inArray(games.id, [...new Set(gameIds)]) : undefined;
  return gameViewRows(ctx, where).map(toGameRow);
}
