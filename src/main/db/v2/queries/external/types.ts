import type { IgdbCollection, ReleaseDatePrecision, SteamTag } from '../../schema';

// Las formas de lo que traen las fuentes externas, tal como las reciben las
// consultas de este paquete (P6 · refresco externo y claves).
//
// Son copias ESTRUCTURALES de los tipos de las funciones de red
// (`igdb/types.ts`, `hltb/types.ts`, `external/steamData.ts`), no
// importaciones: así este paquete no arrastra los módulos de red (y sus
// dependencias de Electron) a los tests, y la red se puede cambiar sin tocar
// la base. Lo que devuelven hoy esas funciones encaja tal cual.

/** El refresco que lanza un botón, o el que mira solo los planeados. */
export type RefreshScope = 'plan' | 'all';

/**
 * Lo que el lote de IGDB trae de un juego ya dado de alta
 * (`GameExternalData`, `igdb/types.ts`): notas, sinopsis, sagas y fecha.
 */
export interface IgdbBatchData {
  readonly ratingCritics: number | null;
  readonly ratingCriticsCount: number | null;
  readonly ratingUsers: number | null;
  readonly ratingUsersCount: number | null;
  readonly summary: string | null;
  readonly igdbCollections: readonly IgdbCollection[] | null;
  readonly releaseYear: number | null;
  readonly releaseDate: Date | null;
  readonly releaseDatePrecision: ReleaseDatePrecision | null;
}

/**
 * El detalle de IGDB de UN juego (`IgdbGameDetail`), solo con lo que guarda la
 * base. La adopción lo usa entero; el refresco de la ficha y el de notas, la
 * parte del lote (`igdbDetailToBatch`).
 */
export interface IgdbDetailData {
  readonly igdbId: number;
  readonly title: string;
  readonly covers: readonly string[];
  readonly heroes: readonly string[];
  readonly developer: string | null;
  readonly publisher: string | null;
  readonly genres: readonly string[];
  readonly platforms: readonly string[];
  readonly summary: string | null;
  readonly igdbCollections: readonly IgdbCollection[] | null;
  readonly release: { readonly date: Date; readonly precision: ReleaseDatePrecision } | null;
  readonly releaseYear: number | null;
  readonly ratingCritics: number | null;
  readonly ratingCriticsCount: number | null;
  readonly ratingUsers: number | null;
  readonly ratingUsersCount: number | null;
}

/** Los tres tramos de HowLongToBeat (`HltbTimes`). Un tramo null = HLTB no lo sabe. */
export interface HltbTimesData {
  readonly hltbMain: number | null;
  readonly hltbMainExtras: number | null;
  readonly hltbCompletionist: number | null;
}

/**
 * Lo que Steam supo de un appid (`SteamGamePatch`, `external/steamData.ts`):
 * solo los campos averiguados. Un campo ausente = Steam no lo sabe hoy, y NO
 * borra el dato anterior (un "no" externo no borra lo que había, §14.2).
 */
export interface SteamStoreData {
  readonly steamTags?: readonly SteamTag[] | null;
  readonly steamPositive?: number | null;
  readonly steamNegative?: number | null;
}

/**
 * Resultado de buscar o revisar el appid de Steam de un juego.
 * - `found`: no lo tenía y ha aparecido.
 * - `corrected`: tenía uno que apuntaba al playtest o a otro producto
 *   (`external/steamAppIdFix.ts`), y este es el bueno.
 * - `not-on-steam`: se preguntó y no está en Steam.
 */
export type AppIdResolution =
  | { readonly kind: 'found'; readonly appId: number }
  | { readonly kind: 'corrected'; readonly appId: number }
  | { readonly kind: 'not-on-steam' };

/** Una fuente que se preguntó y falló (red, 5xx…): se apunta, no borra nada. */
export interface SourceFailure {
  readonly failed: true;
  readonly error?: string;
}

export const failed = (error?: unknown): SourceFailure => ({
  failed: true,
  ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
});

export const isFailure = (value: unknown): value is SourceFailure =>
  typeof value === 'object' && value !== null && (value as { failed?: unknown }).failed === true;
