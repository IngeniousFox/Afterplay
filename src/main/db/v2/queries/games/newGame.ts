import { eq } from 'drizzle-orm';
import type { GameSource } from '../../../../../shared/types';
import { gameIdForIgdb, uuidv7 } from '../../../../../shared/sync/ids';
import {
  gameMetadata,
  games,
  type GameRow as GameTableRow,
  type IgdbCollection,
} from '../../schema';
import type { CreateValues } from '../../store';
import { writeCheck, type QueryContext } from '../common';
import { GameWriteError, assertSteamAppId } from './errors';

// El alta de la FILA del juego, compartida por `createGameWithDetails` y
// `createPlannedGame` (CONSULTAS.md §1.4, `CreateGameWithDetailsInput` y
// `CreatePlannedGameInput`): reparte el resultado del enriquecimiento externo
// entre `games` (identidad y elecciones del usuario), `game_metadata` (la
// caché que solo escribe el refresco) y `external_checks` (cuándo se preguntó).
//
// La red NO es de aquí: quien llama (el IPC, en P9) pide antes el
// enriquecimiento con `planEnrichmentRequest` + `resolveGameEnrichment`, y
// pasa el resultado como dato. Así ninguna transacción espera a la red.

/**
 * El resultado del enriquecimiento externo tal como lo necesita el alta 2.0.
 * Es un subconjunto estructural de `GameEnrichment` (1.x,
 * `db/queries/games/resolveGameEnrichment.ts`): se le puede pasar ese objeto
 * tal cual, SIEMPRE que se haya pedido con `planEnrichmentRequest` (carátula y
 * banner sin elección del usuario), para que `coverUrl`/`heroUrl` sean las
 * candidatas AUTOMÁTICAS y no la elección mezclada (§1.4, `coverUrl`).
 */
export interface GameEnrichmentData {
  readonly title: string;
  /** null = alta desde Steam porque IGDB no lo tiene. */
  readonly igdbId: number | null;
  /** El detectado, o el forzado si se pidió con `steamAppIdOverride`. */
  readonly steamAppId: number | null;
  /** El buscado, o el elegido si se pidió con `steamGridDbId`. */
  readonly steamGridDbId: number | null;
  readonly coverUrl: string | null;
  readonly heroUrl: string | null;
  readonly developer: string | null;
  readonly publisher: string | null;
  readonly genres: string[] | null;
  readonly officialPlatforms: string[] | null;
  readonly releaseYear: number | null;
  readonly releaseDate: Date | null;
  readonly releaseDatePrecision: 'year' | 'month' | 'day' | null;
  readonly summary: string | null;
  readonly igdbCollections: IgdbCollection[] | null;
  readonly hltbMain: number | null;
  readonly hltbMainExtras: number | null;
  readonly hltbCompletionist: number | null;
  readonly ratingCritics: number | null;
  readonly ratingCriticsCount: number | null;
  readonly ratingUsers: number | null;
  readonly ratingUsersCount: number | null;
}

/** Lo que el formulario del alta decide sobre la identidad y el arte. */
export interface NewGameChoices {
  /** Elegidas en el CoverPicker. null = sin elección propia (automática). */
  readonly coverUrl: string | null;
  readonly heroUrl: string | null;
  /** Tecleado a mano. null = el que encuentre la búsqueda. */
  readonly steamGridDbId: number | null;
  /** Forzado a mano. null u omitido = el detectado. */
  readonly steamAppIdOverride?: number | null;
}

/**
 * Los argumentos de `resolveGameEnrichment` (1.x) para el alta 2.0. Misma
 * forma que `{ source, overrides: GameEnrichmentOverrides }`.
 */
export interface EnrichmentRequest {
  readonly source: GameSource;
  readonly overrides: {
    // Siempre null: la elección del usuario va a `*Override` y la candidata
    // automática a `game_metadata`. Si se pasara la elección, la función de
    // red la devolvería como `coverUrl` y se perdería la automática.
    readonly coverUrl: null;
    readonly heroUrl: null;
    readonly steamGridDbId: number | null;
    readonly steamAppIdOverride: number | null;
  };
}

/**
 * Qué pedir a la red antes del alta (paso puro, sin base). Valida el appid
 * forzado y, como la 1.x (`createGameWithDetails.ts:24-27`), si el alta viene
 * de la búsqueda de Steam y el appid está forzado, la ficha se pide de ESE
 * appid.
 */
export function planEnrichmentRequest(
  input: { readonly source: GameSource } & NewGameChoices,
): EnrichmentRequest {
  const forced = input.steamAppIdOverride ?? null;
  if (forced !== null) assertSteamAppId(forced);
  const source: GameSource =
    forced !== null && 'steamAppId' in input.source ? { steamAppId: forced } : input.source;
  return {
    source,
    overrides: {
      coverUrl: null,
      heroUrl: null,
      steamGridDbId: input.steamGridDbId,
      steamAppIdOverride: forced,
    },
  };
}

/**
 * El juego VIVO que ya ocupa el id de ese igdbId, o null. El IPC puede
 * preguntarlo ANTES de ir a la red, para no gastar la llamada en un alta que
 * va a fallar con `already_exists`.
 */
export function findLiveGameIdForIgdb(ctx: QueryContext, igdbId: number): string | null {
  const id = gameIdForIgdb(igdbId);
  const row = ctx.db
    .select({ deleted: games.syncDeleted })
    .from(games)
    .where(eq(games.id, id))
    .get();
  return row && row.deleted === null ? id : null;
}

export interface WriteNewGameInput {
  readonly enrichment: GameEnrichmentData;
  readonly choices: NewGameChoices;
  /** Notas del juego. null = no escribió ninguna. */
  readonly notes: string | null;
  /** Solo el alta normal los pregunta; el Plan no (se quedan como estuvieran). */
  readonly endless?: boolean;
  readonly isEmulated?: boolean;
}

export interface WrittenGame {
  readonly gameId: string;
  /** El `addedAt` escrito: el ancla de las fechas desconocidas del alta (R-07). */
  readonly addedAt: Date;
  /** Volvía de una lápida (mismo igdbId que un juego borrado). */
  readonly resurrected: boolean;
}

/**
 * Escribe `games`, `game_metadata` y `external_checks` de un alta. Debe
 * llamarse dentro de la transacción de quien llama (sus hijos van en la
 * misma).
 *
 * Con `igdbId`, el id es determinista (§7.2):
 * - si ya hay un juego VIVO con ese id → `GameWriteError('already_exists')`
 *   sin escribir nada (crear encima sería pisar un juego de la biblioteca);
 * - si lo hay con lápida, el juego RESUCITA (§20.3.1, decidido): vuelven sus
 *   notas, arte elegido y claves fijadas a mano (lo que aquí se omite), y sus
 *   hijos (playthroughs, plan, gastos…) siguen borrados. Lo que no debe volver
 *   se indica explícitamente: `promotedAt`, una clave automática vieja.
 *
 * Omitir frente a null (H-2): en una fila NUEVA no se escribe lo que no
 * consta (los null del enriquecimiento y del formulario se omiten), para que
 * otro PC que dé de alta el mismo juego offline no vea su dato real pisado por
 * un null con reloj de creación.
 */
export function writeNewGame(ctx: QueryContext, input: WriteNewGameInput): WrittenGame {
  const { enrichment, choices } = input;
  const igdbId = enrichment.igdbId;
  const forced = choices.steamAppIdOverride ?? null;
  if (forced !== null) assertSteamAppId(forced);

  const existing: GameTableRow | undefined =
    igdbId === null
      ? undefined
      : ctx.db
          .select()
          .from(games)
          .where(eq(games.id, gameIdForIgdb(igdbId)))
          .get();
  if (existing && existing.syncDeleted === null) {
    throw new GameWriteError(
      'already_exists',
      `El juego de IGDB ${igdbId} ya está en Afterplay (${existing.title})`,
    );
  }

  const addedAt = ctx.now();
  // Sin igdbId el id es aleatorio: se genera aquí para poder escribir
  // `saveKey = id` en la misma creación, en vez de crear y luego parchear.
  const id = igdbId === null ? uuidv7(addedAt.getTime()) : gameIdForIgdb(igdbId);

  const values: CreateValues<'games'> = {
    id,
    title: enrichment.title,
    addedAt,
    ...(igdbId !== null ? { igdbId } : {}),
    ...steamAppIdValues(existing, forced, enrichment.steamAppId),
    ...sgdbValues(existing, choices.steamGridDbId, enrichment.steamGridDbId),
    ...(choices.coverUrl !== null ? { coverOverride: choices.coverUrl } : {}),
    ...(choices.heroUrl !== null ? { heroOverride: choices.heroUrl } : {}),
    ...(input.notes !== null ? { notes: input.notes } : {}),
    ...(input.endless !== undefined ? { endless: input.endless } : {}),
    ...(input.isEmulated !== undefined ? { isEmulated: input.isEmulated } : {}),
    // Un juego que vuelve no arrastra la promoción de su vida anterior: sin
    // esto, sus eventos de alta se anclarían a una fecha vieja.
    ...(existing && existing.promotedAt !== null ? { promotedAt: null } : {}),
    // El prefijo del bucket no cambia nunca (§12.7): un juego que vuelve
    // conserva el suyo, y sus copias de partidas siguen donde estaban.
    ...(existing?.saveKey ? {} : { saveKey: igdbId !== null ? String(igdbId) : id }),
  };
  const { outcome } = ctx.store.create('games', values);

  writeMetadata(ctx, id, enrichment);
  writeChecks(ctx, id, enrichment, choices);

  return { gameId: id, addedAt, resurrected: outcome === 'resurrected' };
}

type KeyValues<K extends string, S extends string> = Partial<
  Record<K, number | null> & Record<S, 'auto' | 'manual' | null>
>;

/**
 * El appid: forzado → manual (sustituye a `steamAppIdManual`, §1.4); si no, el
 * detectado con `'auto'`. Al resucitar, una elección manual de antes se
 * respeta (D-22) y un automático viejo sin sustituto se limpia.
 */
function steamAppIdValues(
  existing: GameTableRow | undefined,
  forced: number | null,
  detected: number | null,
): KeyValues<'steamAppId', 'steamAppIdSource'> {
  if (forced !== null) return { steamAppId: forced, steamAppIdSource: 'manual' };
  if (existing?.steamAppIdSource === 'manual') return {};
  if (detected !== null) return { steamAppId: detected, steamAppIdSource: 'auto' };
  return existing && existing.steamAppId !== null
    ? { steamAppId: null, steamAppIdSource: null }
    : {};
}

/** El id de SteamGridDB, con la misma regla que el appid. */
function sgdbValues(
  existing: GameTableRow | undefined,
  chosen: number | null,
  found: number | null,
): KeyValues<'sgdbId', 'sgdbIdSource'> {
  if (chosen !== null) return { sgdbId: chosen, sgdbIdSource: 'manual' };
  if (existing?.sgdbIdSource === 'manual') return {};
  if (found !== null) return { sgdbId: found, sgdbIdSource: 'auto' };
  return existing && existing.sgdbId !== null ? { sgdbId: null, sgdbIdSource: null } : {};
}

// Las columnas de `game_metadata` que salen del enriquecimiento.
const METADATA_KEYS = [
  'coverUrl',
  'heroUrl',
  'developer',
  'publisher',
  'genres',
  'officialPlatforms',
  'releaseYear',
  'releaseDate',
  'releaseDatePrecision',
  'summary',
  'igdbCollections',
  'hltbMain',
  'hltbMainExtras',
  'hltbCompletionist',
  'ratingCritics',
  'ratingCriticsCount',
  'ratingUsers',
  'ratingUsersCount',
] as const satisfies readonly (keyof GameEnrichmentData & keyof typeof gameMetadata.$inferInsert)[];

/**
 * La caché del juego. Solo los valores que la fuente dio: un null del
 * enriquecimiento puede ser "no lo tiene" o "falló y se siguió sin él"
 * (HLTB y SGDB se tragan sus errores), y en ninguno de los dos casos consta
 * nada que escribir. La caché de un juego borrado se conserva (`keep`), así
 * que al resucitar lo que no venga ahora se queda con el valor de antes.
 */
function writeMetadata(ctx: QueryContext, gameId: string, enrichment: GameEnrichmentData): void {
  const values: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    const value = enrichment[key];
    if (value !== null) values[key] = value;
  }
  if (Object.keys(values).length === 0) return;
  ctx.store.create('game_metadata', { gameId, ...values } as CreateValues<'game_metadata'>);
}

/**
 * Los sellos que el alta deja puestos, como la 1.x (`steamAppIdCheckedAt`,
 * `ratingsCheckedAt`), para que las pasadas de arranque no vuelvan a
 * preguntar por un juego recién añadido:
 * - `steam_appid`: siempre (la 1.x lo sellaba siempre): `ok` con appid,
 *   `empty` sin él.
 * - `igdb_ratings`: `ok` si vino de IGDB; `empty` si de Steam (sin igdbId no
 *   hay notas que pedir).
 * - `hltb` y `sgdb`: solo `ok` cuando hay dato. Sin dato no se sabe si fue
 *   "no lo tiene" o un fallo tragado, así que se deja sin fila ("nunca
 *   preguntado"), que es lo que la repesca de huérfanos busca.
 */
function writeChecks(
  ctx: QueryContext,
  gameId: string,
  enrichment: GameEnrichmentData,
  choices: NewGameChoices,
): void {
  writeCheck(ctx, gameId, 'steam_appid', enrichment.steamAppId !== null ? 'ok' : 'empty');
  writeCheck(ctx, gameId, 'igdb_ratings', enrichment.igdbId !== null ? 'ok' : 'empty');
  const hasHltb =
    enrichment.hltbMain !== null ||
    enrichment.hltbMainExtras !== null ||
    enrichment.hltbCompletionist !== null;
  if (hasHltb) writeCheck(ctx, gameId, 'hltb', 'ok');
  // Un id tecleado a mano no es una respuesta de SteamGridDB.
  if (choices.steamGridDbId === null && enrichment.steamGridDbId !== null) {
    writeCheck(ctx, gameId, 'sgdb', 'ok');
  }
}
