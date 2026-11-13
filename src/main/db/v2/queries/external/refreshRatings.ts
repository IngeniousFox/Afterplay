import type { QueryContext } from '../common/context';
import { readLiveIdentity, recordCheck, sameSteamIdentity } from './internal';
import { applyIgdbBatch, applySteamPart } from './refreshPass';
import type { ExternalSnapshot } from './snapshot';
import { isFailure, type AppIdResolution, type IgdbBatchData, type SourceFailure } from './types';

// El ⟳ de la card "Ratings" (`external/refreshRatings.ts`,
// `refreshGameRatings`): las notas de IGDB (y lo que su detalle trae en la
// misma respuesta: sinopsis, sagas, fecha) y el % de reseñas de Steam.
//
//   1. Foto: `readExternalSnapshot`.
//   2. Red: `getGameDetails`, el appid (buscar si falta, revisar si lo tiene)
//      y `getSteamReviewCounts` del appid que toque.
//   3. `applyRatingsRefreshResult`: transacción que relee y escribe.
//
// Como hoy: aquí no se piden etiquetas, así que al corregir el appid solo se
// tiran las reseñas del producto viejo (las etiquetas las arregla el botón de
// "actualizar el juego entero"). El llamador re-encola los logros si el appid
// cambió de producto.

export interface RatingsRefreshNetworkResult {
  /** Igual que en `RefreshGameNetworkResult.igdb`. */
  readonly igdb?: IgdbBatchData | null | SourceFailure;
  readonly appId?: AppIdResolution;
  /**
   * Las reseñas del appid que tocaba: los dos números, `null` (Steam no supo
   * nada) o ausente (no había appid).
   */
  readonly reviews?: { readonly steamPositive: number; readonly steamNegative: number } | null;
}

export type RatingsRefreshOutcome =
  | { readonly status: 'gone' }
  | {
      readonly status: 'applied';
      readonly appIdChanged: 'found' | 'corrected' | null;
      readonly discarded: readonly ('igdb' | 'steam')[];
    };

export function applyRatingsRefreshResult(
  ctx: QueryContext,
  snapshot: ExternalSnapshot,
  result: RatingsRefreshNetworkResult,
): RatingsRefreshOutcome {
  return ctx.store.transaction((): RatingsRefreshOutcome => {
    const current = readLiveIdentity(ctx, snapshot.gameId);
    if (!current) return { status: 'gone' };
    const discarded: ('igdb' | 'steam')[] = [];

    if (result.igdb !== undefined) {
      if (current.igdbId !== snapshot.igdbId || current.igdbId === null) discarded.push('igdb');
      else if (isFailure(result.igdb)) {
        recordCheck(ctx, current.id, 'igdb_ratings', 'error', { error: result.igdb.error });
      } else applyIgdbBatch(ctx, current, result.igdb);
    }

    let appIdChanged: 'found' | 'corrected' | null = null;
    if (result.appId !== undefined || result.reviews !== undefined) {
      if (!sameSteamIdentity(current, snapshot)) discarded.push('steam');
      else {
        const steam =
          result.reviews === undefined
            ? undefined
            : result.reviews === null
              ? null
              : {
                  steamPositive: result.reviews.steamPositive,
                  steamNegative: result.reviews.steamNegative,
                };
        appIdChanged = applySteamPart(ctx, current, result.appId, steam, 'reviews');
      }
    }

    return { status: 'applied', appIdChanged, discarded };
  });
}
