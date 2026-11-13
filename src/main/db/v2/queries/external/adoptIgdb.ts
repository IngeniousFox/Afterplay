import { and, asc, isNotNull, isNull } from 'drizzle-orm';
import { games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import { readLiveIdentity, recordCheck, writeMetadata } from './internal';
import { isFailure, type IgdbDetailData, type SourceFailure } from './types';

// La adopción de IGDB (`external/adoptIgdb.ts`): un juego dado de alta solo
// con Steam que por fin aparece en IGDB se cambia de fuente ENTERO.
//
// Patrón de tres pasos (CONSULTAS.md §2.3):
//   1. `selectAdoptionCandidates` (síncrona).
//   2. Red, fuera de toda transacción: `getIgdbIdsBySteamAppIds` y
//      `getGameDetails` de los que aparezcan.
//   3. `applyIgdbAdoption` por juego: una transacción corta que RELEE.
//
// Qué escribe (decisión R-01, que conserva el comportamiento de hoy):
// - `games.igdbId` y `games.title` (el título pasa al de IGDB, como hoy).
// - `game_metadata` con TODO lo del detalle: carátula, banner, estudio,
//   editora, géneros, plataformas, sinopsis, sagas, fecha y notas. Con null
//   donde IGDB no trae (un juego a medias entre dos fuentes es peor que uno
//   sin imagen, `adoptIgdb.ts:64-67`), salvo `releaseYear`, que nunca se pone
//   a null.
// - Y ANULA los cinco overrides (carátula, banner, estudio, editora, géneros):
//   "cámbialo todo a IGDB" se paga una vez por juego. Es la excepción
//   explícita a "el refresco nunca escribe un override" (R-01).
// - `external_checks`: `igdb_ratings` ok (vienen las notas) e `igdb` ok.
//
// Qué NO cambia: el id del juego (§7.2, "caso residual": un juego que gana
// igdbId conserva su UUIDv7; si otro PC lo añadió por IGDB quedan dos filas y
// la interfaz ofrece fusionarlas), `saveKey` (§12.7: sus copias siguen bajo el
// prefijo antiguo), las claves manuales y nada del usuario.

export interface AdoptionCandidate {
  readonly gameId: string;
  readonly steamAppId: number;
}

/**
 * Juegos vivos sin `igdbId` y con appid: sin appid no hay por dónde preguntar.
 * No mira `external_checks`: hoy se re-pregunta a todos en cada refresco (los
 * tres que adoptan), y así sigue.
 */
export function selectAdoptionCandidates(ctx: QueryContext): AdoptionCandidate[] {
  const rows = ctx.db
    .select({ gameId: games.id, steamAppId: games.steamAppId })
    .from(games)
    .where(and(alive(games), isNull(games.igdbId), isNotNull(games.steamAppId)))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
  return rows.filter((row): row is AdoptionCandidate => row.steamAppId !== null);
}

/**
 * Lo que dijo IGDB de un candidato:
 * - un detalle: IGDB ya lo tiene, se adopta;
 * - `null`: IGDB sigue sin tenerlo (el appid no está enlazado, o el detalle no
 *   existe);
 * - un fallo: no se pudo preguntar.
 */
export type AdoptionLookup = IgdbDetailData | null | SourceFailure;

export type AdoptionOutcome =
  /** Adoptado: el juego tiene ya el igdbId del detalle. */
  | 'adopted'
  /** IGDB sigue sin tenerlo; queda apuntado (`igdb` = empty). */
  | 'not-found'
  /** No se pudo preguntar; queda apuntado como fallo si no había respuesta. */
  | 'failed'
  /** Borrado, o ya no es candidato (ganó igdbId o cambió de appid durante la red). */
  | 'skipped';

/**
 * Aplica el resultado de IGDB para un candidato, en una transacción que relee:
 * el juego tiene que seguir vivo, sin `igdbId` y con el MISMO appid con el que
 * se preguntó (si el usuario le cambió el appid a mano entretanto, el igdbId
 * encontrado era de otro producto).
 */
export function applyIgdbAdoption(
  ctx: QueryContext,
  candidate: AdoptionCandidate,
  lookup: AdoptionLookup,
): AdoptionOutcome {
  return ctx.store.transaction((): AdoptionOutcome => {
    const current = readLiveIdentity(ctx, candidate.gameId);
    if (!current || current.igdbId !== null || current.steamAppId !== candidate.steamAppId) {
      return 'skipped';
    }
    if (isFailure(lookup)) {
      recordCheck(ctx, current.id, 'igdb', 'error', lookup.error);
      return 'failed';
    }
    if (lookup === null) {
      recordCheck(ctx, current.id, 'igdb', 'empty');
      return 'not-found';
    }

    const detail = lookup;
    ctx.store.patch('games', current.id, {
      igdbId: detail.igdbId,
      title: detail.title,
      // R-01: la adopción pisa lo que se ve, como hoy. Ningún otro refresco
      // escribe aquí (salvo para borrar un override igual al automático).
      coverOverride: null,
      heroOverride: null,
      developerOverride: null,
      publisherOverride: null,
      genresOverride: null,
    });
    writeMetadata(
      ctx,
      { ...current, igdbId: detail.igdbId, title: detail.title },
      {
        coverUrl: detail.covers[0] ?? null,
        heroUrl: detail.heroes[0] ?? null,
        developer: detail.developer,
        publisher: detail.publisher,
        genres: detail.genres.length > 0 ? [...detail.genres] : null,
        officialPlatforms: detail.platforms.length > 0 ? [...detail.platforms] : null,
        summary: detail.summary,
        igdbCollections: detail.igdbCollections === null ? null : [...detail.igdbCollections],
        releaseDate: detail.release?.date ?? null,
        releaseDatePrecision: detail.release?.precision ?? null,
        ...(detail.releaseYear !== null ? { releaseYear: detail.releaseYear } : {}),
        ratingCritics: detail.ratingCritics,
        ratingCriticsCount: detail.ratingCriticsCount,
        ratingUsers: detail.ratingUsers,
        ratingUsersCount: detail.ratingUsersCount,
      },
    );
    recordCheck(ctx, current.id, 'igdb', 'ok');
    recordCheck(ctx, current.id, 'igdb_ratings', 'ok');
    return 'adopted';
  });
}
