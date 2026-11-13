import { and, eq } from 'drizzle-orm';
import { sameValue } from '../../../../../shared/sync/fieldClocks';
import {
  gameMetadata,
  games,
  type CheckStatus,
  type ExternalCheckSource,
  type KeySource,
} from '../../schema';
import { alive, type CreateValues, type PatchValues } from '../../store';
import { CHECK_POLICIES, clearCheck, readCheck, writeCheck } from '../common/checks';
import type { QueryContext } from '../common/context';
import type { HltbTimesData, IgdbBatchData, IgdbDetailData, SteamStoreData } from './types';

// Piezas internas del paquete P6. No las exporta `index.ts`: son la regla de
// la casa para escribir caché, y quien está fuera de `external/` no debería
// escribir caché externa.
//
// Las tres reglas de fondo de CONSULTAS.md §3.5 viven aquí, en un solo sitio:
// - "el refresco solo escribe caché" (D-22, F-36): `writeMetadata` escribe en
//   `game_metadata` y nunca en un `*Override`, salvo para BORRAR uno que ha
//   resultado igual al automático (§19.5); `setAutoKey` no toca una clave con
//   `…Source = 'manual'`;
// - "escribir solo lo que cambia" (F-33): todo pasa por la puerta, que no
//   escribe un parche sin cambios, y `recordCheck` no re-sella una respuesta
//   repetida que no tiene cadencia;
// - "relectura" (R-15): todas reciben la identidad RELEÍDA dentro de la
//   transacción de quien llama (`readLiveIdentity`), nunca la de la foto.

// ── Identidad ──────────────────────────────────────────────────────────────

/** Las claves externas de un juego vivo: lo que la relectura compara con la foto. */
export interface GameIdentity {
  readonly id: string;
  readonly title: string;
  readonly igdbId: number | null;
  readonly steamAppId: number | null;
  readonly steamAppIdSource: KeySource | null;
  readonly raGameId: number | null;
  readonly sgdbId: number | null;
  readonly sgdbIdSource: KeySource | null;
}

/** La identidad del juego si existe y está vivo; null si no existe o tiene lápida. */
export function readLiveIdentity(ctx: QueryContext, gameId: string): GameIdentity | null {
  const row = ctx.db
    .select({
      id: games.id,
      title: games.title,
      igdbId: games.igdbId,
      steamAppId: games.steamAppId,
      steamAppIdSource: games.steamAppIdSource,
      raGameId: games.raGameId,
      sgdbId: games.sgdbId,
      sgdbIdSource: games.sgdbIdSource,
    })
    .from(games)
    .where(and(eq(games.id, gameId), alive(games)))
    .get();
  return row ?? null;
}

/** La identidad de Steam que se vio en la foto (antes de la red). */
export interface SteamIdentity {
  readonly steamAppId: number | null;
  readonly steamAppIdSource: KeySource | null;
}

/**
 * ¿Sigue el juego con el appid y el origen que tenía en la foto? Es la guarda
 * de la 1.x (`sameSteamIdentity`, `refresh.ts:543`): si el usuario fijó un
 * appid a mano o alguien lo cambió durante la red, lo de Steam que se trajo es
 * de otro producto y no se escribe.
 */
export const sameSteamIdentity = (current: GameIdentity, seen: SteamIdentity): boolean =>
  current.steamAppId === seen.steamAppId &&
  (current.steamAppIdSource ?? null) === (seen.steamAppIdSource ?? null);

// ── Claves ─────────────────────────────────────────────────────────────────

/**
 * Pone el appid de Steam como automático. Devuelve false (y no escribe) si la
 * clave es manual (D-22, F-36). No compara con el valor anterior: la puerta ya
 * no escribe si no cambia.
 */
export function setAutoSteamAppId(
  ctx: QueryContext,
  current: GameIdentity,
  appId: number,
): boolean {
  if (current.steamAppIdSource === 'manual') return false;
  ctx.store.patch('games', current.id, { steamAppId: appId, steamAppIdSource: 'auto' });
  return true;
}

/**
 * Pone el id de SteamGridDB como automático, solo si el juego no tiene
 * ninguno: el que haya puede ser el que elegiste en el CoverPicker. Devuelve
 * si lo escribió.
 */
export function fillAutoSgdbId(ctx: QueryContext, current: GameIdentity, sgdbId: number): boolean {
  if (current.sgdbId !== null || current.sgdbIdSource === 'manual') return false;
  ctx.store.patch('games', current.id, { sgdbId, sgdbIdSource: 'auto' });
  return true;
}

/**
 * Lo que cuelga del appid y deja de valer cuando el appid cambia de producto:
 * las comprobaciones de logros y desbloqueos de Steam. Al borrarlas el juego
 * vuelve a estar "nunca preguntado" para la pasada de logros (P5,
 * `getPendingAchievementsGames`), además de la re-cola que hace quien llama.
 * El catálogo y los desbloqueos NO se borran aquí: la 1.x tampoco lo hacía en
 * los refrescos (solo `setSteamAppId`, R-09), y la re-sincronización los
 * escribe encima.
 */
export function forgetSteamProductChecks(ctx: QueryContext, gameId: string): void {
  clearCheck(ctx, gameId, 'steam_achievements');
  clearCheck(ctx, gameId, 'steam_unlocks');
}

// ── Sellos ─────────────────────────────────────────────────────────────────

/**
 * Apunta una comprobación (`external_checks`) con dos reglas encima de
 * `writeCheck`:
 *
 * 1. Un FALLO no pisa una respuesta anterior (`ok`/`empty`). En la 1.x un
 *    fallo no dejaba sello y el anterior seguía en pie; pisarlo convertiría un
 *    juego ya preguntado en "nunca preguntado" (sube `neverChecked` en
 *    Ajustes) por un 503 pasajero. "Un no externo no borra lo que había"
 *    (§14.2) vale también para los sellos.
 * 2. Una respuesta IGUAL a la anterior y sin cadencia (`nextCheckAt` null en
 *    la política: casi todas) no se re-sella. Si no, el refresco semanal
 *    reescribiría una fila por juego y fuente cada semana, que es justo F-33.
 *    Consecuencia: `checkedAt` es "desde cuándo la fuente responde esto", no
 *    "la última vez que se preguntó". Las respuestas con cadencia (`ra_match`
 *    sin set, los fallos) sí se re-sellan siempre: su `nextCheckAt` se mueve.
 *
 * Devuelve si escribió. No escribe nada si el juego no está vivo (R-15).
 */
export function recordCheck(
  ctx: QueryContext,
  gameId: string,
  source: ExternalCheckSource,
  status: CheckStatus,
  error?: string | null,
): boolean {
  const previous = readCheck(ctx, gameId, source);
  if (previous) {
    if (status === 'error' && previous.status !== 'error') return false;
    const sameAnswer =
      previous.status === status &&
      (previous.error ?? null) === (status === 'error' ? (error ?? null) : null);
    if (sameAnswer && CHECK_POLICIES[source][status] === null) return false;
  }
  return writeCheck(ctx, gameId, source, status, { error: error ?? null });
}

// ── Caché de metadatos ─────────────────────────────────────────────────────

type MetadataValues = Omit<CreateValues<'game_metadata'>, 'id' | 'gameId'>;

/** Columnas de `game_metadata` que tienen override del usuario en `games` (D-22). */
const OVERRIDES = {
  coverUrl: 'coverOverride',
  heroUrl: 'heroOverride',
  developer: 'developerOverride',
  publisher: 'publisherOverride',
  genres: 'genresOverride',
} as const satisfies Partial<Record<keyof MetadataValues, keyof PatchValues<'games'>>>;

type OverriddenColumn = keyof typeof OVERRIDES;

/**
 * Escribe en la caché del juego (`game_metadata`, id = gameId) los campos
 * indicados, y SOLO esos: lo omitido se queda como estaba (y, al crear la
 * fila, con reloj BOTTOM, H-2). Si nada cambia, la puerta no escribe (F-33).
 *
 * Regla de §19.5 (R-01): si un campo con override llega con el MISMO valor
 * que el override, el override se borra: no era una corrección del usuario,
 * era el valor automático copiado por el importador. Es la única escritura en
 * un `*Override` que hace el refresco, y solo para ponerlo a null.
 *
 * `current` tiene que ser la identidad releída dentro de la transacción de
 * quien llama (juego vivo).
 */
export function writeMetadata(
  ctx: QueryContext,
  current: GameIdentity,
  values: MetadataValues,
): void {
  const fields = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as MetadataValues;
  if (Object.keys(fields).length === 0) return;
  ctx.store.create('game_metadata', { gameId: current.id, ...fields });
  clearOverridesEqualTo(ctx, current.id, fields);
}

function clearOverridesEqualTo(ctx: QueryContext, gameId: string, fields: MetadataValues): void {
  const touched = (Object.keys(OVERRIDES) as OverriddenColumn[]).filter(
    (column) => fields[column] !== undefined && fields[column] !== null,
  );
  if (touched.length === 0) return;
  const overrides = ctx.db
    .select({
      coverOverride: games.coverOverride,
      heroOverride: games.heroOverride,
      developerOverride: games.developerOverride,
      publisherOverride: games.publisherOverride,
      genresOverride: games.genresOverride,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  if (!overrides) return;
  const patch: PatchValues<'games'> = {};
  for (const column of touched) {
    const overrideColumn = OVERRIDES[column];
    const override = overrides[overrideColumn];
    if (override !== null && sameValue(override, fields[column])) {
      (patch as Record<string, unknown>)[overrideColumn] = null;
    }
  }
  if (Object.keys(patch).length > 0) ctx.store.patch('games', gameId, patch);
}

/** La caché viva del juego, o undefined. */
export function readMetadata(
  ctx: QueryContext,
  gameId: string,
): typeof gameMetadata.$inferSelect | undefined {
  return ctx.db
    .select()
    .from(gameMetadata)
    .where(and(eq(gameMetadata.id, gameId), alive(gameMetadata)))
    .get();
}

// ── Del resultado de la red a columnas ─────────────────────────────────────

/**
 * Las columnas del lote de IGDB (`buildIgdbBatchPatch`, `external/igdbPatch.ts`).
 * `releaseYear` NUNCA se pone a null: de él dependen las estadísticas y el
 * emparejado con HowLongToBeat.
 */
export function igdbBatchFields(data: IgdbBatchData): MetadataValues {
  return {
    ratingCritics: data.ratingCritics,
    ratingCriticsCount: data.ratingCriticsCount,
    ratingUsers: data.ratingUsers,
    ratingUsersCount: data.ratingUsersCount,
    summary: data.summary,
    igdbCollections: data.igdbCollections === null ? null : [...data.igdbCollections],
    releaseDate: data.releaseDate,
    releaseDatePrecision: data.releaseDatePrecision,
    ...(data.releaseYear !== null ? { releaseYear: data.releaseYear } : {}),
  };
}

/** La parte "de lote" del detalle de IGDB (lo que guardan la ficha y el ⟳ de notas). */
export function igdbDetailToBatch(detail: IgdbDetailData): IgdbBatchData {
  return {
    ratingCritics: detail.ratingCritics,
    ratingCriticsCount: detail.ratingCriticsCount,
    ratingUsers: detail.ratingUsers,
    ratingUsersCount: detail.ratingUsersCount,
    summary: detail.summary,
    igdbCollections: detail.igdbCollections,
    releaseYear: detail.releaseYear,
    releaseDate: detail.release?.date ?? null,
    releaseDatePrecision: detail.release?.precision ?? null,
  };
}

/**
 * Tramo a tramo y SOLO los que HLTB supo: escribir los tres en bloque borraba
 * lo que ya había con los null de un match parcial (`refreshGame.ts:163-176`).
 */
export function hltbFields(times: HltbTimesData): MetadataValues {
  return {
    ...(times.hltbMain !== null ? { hltbMain: times.hltbMain } : {}),
    ...(times.hltbMainExtras !== null ? { hltbMainExtras: times.hltbMainExtras } : {}),
    ...(times.hltbCompletionist !== null ? { hltbCompletionist: times.hltbCompletionist } : {}),
  };
}

export const hasAnyHltbTime = (times: HltbTimesData): boolean =>
  times.hltbMain !== null || times.hltbMainExtras !== null || times.hltbCompletionist !== null;

/** Solo los campos que Steam averiguó (`mergeSteamPatch`): ausente = no borrar. */
export function steamFields(data: SteamStoreData): MetadataValues {
  return {
    ...(data.steamTags !== undefined
      ? { steamTags: data.steamTags === null ? null : [...data.steamTags] }
      : {}),
    ...(data.steamPositive !== undefined ? { steamPositive: data.steamPositive } : {}),
    ...(data.steamNegative !== undefined ? { steamNegative: data.steamNegative } : {}),
  };
}

export const hasSteamData = (data: SteamStoreData | null | undefined): data is SteamStoreData =>
  data !== null && data !== undefined && Object.keys(steamFields(data)).length > 0;

/**
 * Cuando el appid CAMBIA de producto, lo guardado de Steam era del otro juego
 * (no un dato viejo de este): a null primero y lo que Steam conteste encima
 * (`refresh.ts:521-541`, el caso "Trails in the Sky 2nd Chapter").
 */
export const STEAM_FIELDS_CLEARED: MetadataValues = {
  steamTags: null,
  steamPositive: null,
  steamNegative: null,
};
