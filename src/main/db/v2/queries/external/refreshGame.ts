import type { QueryContext } from '../common/context';
import { fillAutoSgdbId, readLiveIdentity, recordCheck, sameSteamIdentity } from './internal';
import { applyHltb, applyIgdbBatch, applySteamPart } from './refreshPass';
import type { ExternalSnapshot } from './snapshot';
import {
  isFailure,
  type AppIdResolution,
  type HltbTimesData,
  type IgdbBatchData,
  type SourceFailure,
  type SteamStoreData,
} from './types';

// "Actualízalo TODO" de un juego, el botón de su ficha
// (`external/refreshGame.ts`, `refreshGameEverything`).
//
//   1. Foto: `readExternalSnapshot`.
//   0bis. Si no tiene igdbId y sí appid: la adopción (`applyIgdbAdoption`) y
//      otra foto, para que el resto ya vaya con la ficha de IGDB.
//   2. Red, cada fuente con su propio catch: IGDB, HLTB, appid, Steam, SGDB.
//   3. `applyRefreshGameResult`: UNA transacción que relee y escribe todo lo
//      reunido (en la 1.x eran dos escrituras sueltas, la adopción y el resto).
//
// Lo que a propósito no entra, como hoy: carátula y banner (son una elección
// del CoverPicker, no un dato que se refresque) y las curiosidades (cuestan
// dinero). Los logros los re-encola quien llama, DESPUÉS de confirmar.

export interface RefreshGameNetworkResult {
  /**
   * Detalle de IGDB en forma de lote (`igdbDetailToBatch`): los datos, `null`
   * si ya no está en su catálogo, un fallo, o ausente si el juego no tiene
   * igdbId (no se preguntó).
   */
  readonly igdb?: IgdbBatchData | null | SourceFailure;
  /** HowLongToBeat: tiempos, `null` (sin match) o fallo. */
  readonly hltb: HltbTimesData | null | SourceFailure;
  /** Appid buscado (no tenía) o revisado (`findSteamAppIdFix`). Ausente = no se preguntó. */
  readonly appId?: AppIdResolution;
  /** Lo de Steam para el appid que tocaba. Ausente = no había appid. */
  readonly steam?: SteamStoreData | null;
  /** El id de SteamGridDB, si le faltaba: el encontrado o `null`. Ausente = no se preguntó. */
  readonly sgdbId?: number | null;
}

export type RefreshGameOutcome =
  | { readonly status: 'gone' }
  | {
      readonly status: 'applied';
      readonly appIdChanged: 'found' | 'corrected' | null;
      readonly discarded: readonly ('igdb' | 'steam' | 'sgdb')[];
    };

/**
 * Escribe lo que la red reunió para un juego. Relee dentro de la transacción:
 * - borrado → nada (`gone`);
 * - el `igdbId` cambió → se descarta lo de IGDB;
 * - el appid o su origen cambió (p. ej. lo fijaste a mano mientras tanto) →
 *   se descarta lo de Steam; una clave manual nunca se sustituye;
 * - ya tiene id de SteamGridDB (lo elegiste mientras tanto) → no se pisa.
 */
export function applyRefreshGameResult(
  ctx: QueryContext,
  snapshot: ExternalSnapshot,
  result: RefreshGameNetworkResult,
): RefreshGameOutcome {
  return ctx.store.transaction((): RefreshGameOutcome => {
    const current = readLiveIdentity(ctx, snapshot.gameId);
    if (!current) return { status: 'gone' };
    const discarded: ('igdb' | 'steam' | 'sgdb')[] = [];

    if (result.igdb !== undefined) {
      if (current.igdbId !== snapshot.igdbId || current.igdbId === null) discarded.push('igdb');
      else if (isFailure(result.igdb)) {
        recordCheck(ctx, current.id, 'igdb_ratings', 'error', { error: result.igdb.error });
      } else applyIgdbBatch(ctx, current, result.igdb);
    }

    applyHltb(ctx, current, result.hltb);

    let appIdChanged: 'found' | 'corrected' | null = null;
    if (result.appId !== undefined || result.steam !== undefined) {
      if (!sameSteamIdentity(current, snapshot)) discarded.push('steam');
      else appIdChanged = applySteamPart(ctx, current, result.appId, result.steam, 'all');
    }

    if (result.sgdbId !== undefined && snapshot.sgdbId === null) {
      if (result.sgdbId === null) {
        if (current.sgdbId === null) recordCheck(ctx, current.id, 'sgdb', 'empty');
      } else if (fillAutoSgdbId(ctx, current, result.sgdbId)) {
        recordCheck(ctx, current.id, 'sgdb', 'ok');
      } else {
        discarded.push('sgdb');
      }
    }

    return { status: 'applied', appIdChanged, discarded };
  });
}
