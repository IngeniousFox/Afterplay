import { and, asc, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import { checkIsDue } from '../common/checks';
import {
  STEAM_FIELDS_CLEARED,
  forgetSteamProductChecks,
  readLiveIdentity,
  recordCheck,
  setAutoSteamAppId,
  writeMetadata,
} from './internal';

// El backfill de arranque del appid de Steam (`steam/appIdBackfill.ts`,
// `runSteamAppIdBackfill`).
//
//   1. `selectSteamAppIdBackfillCandidates`: los que nunca se preguntaron (sin
//      `ec(steam_appid)` viva) o cuyo último intento falló (vencido). En la 1.x
//      era `steamAppIdCheckedAt IS NULL`; un fallo no dejaba sello, así que es
//      el mismo conjunto.
//   2. Red: `getSteamAppIds` por lotes de 150.
//   3. `applySteamAppIdBackfill(lote)`: una transacción por lote que relee.
//
// Diferencias con la 1.x, las dos para no perder datos:
// - Un "no está en Steam" ya no pone `steamAppId = null` encima de un appid
//   que exista (`appIdBackfill.ts:69` podía borrar uno recién resuelto por
//   otra vía): se apunta `empty` y el appid se queda.
// - Si la clave cambió durante la red (otro camino la resolvió, o la fijaste a
//   mano), el juego se salta entero: la respuesta era para otra foto.

export interface SteamAppIdBackfillCandidate {
  readonly gameId: string;
  readonly igdbId: number;
  /** El appid de la foto (casi siempre null). */
  readonly steamAppId: number | null;
}

/**
 * Vivos, con igdbId (el appid se le pregunta a IGDB), sin appid manual, y con
 * `steam_appid` pendiente. Un juego sin igdbId se queda fuera sin marcar: el
 * día que lo gane, esta pasada lo recogerá.
 */
export function selectSteamAppIdBackfillCandidates(
  ctx: QueryContext,
): SteamAppIdBackfillCandidate[] {
  const rows = ctx.db
    .select({ gameId: games.id, igdbId: games.igdbId, steamAppId: games.steamAppId })
    .from(games)
    .where(
      and(
        alive(games),
        isNotNull(games.igdbId),
        or(isNull(games.steamAppIdSource), ne(games.steamAppIdSource, 'manual')),
        checkIsDue('steam_appid', ctx.now()),
      ),
    )
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
  return rows.filter((row): row is SteamAppIdBackfillCandidate => row.igdbId !== null);
}

export interface SteamAppIdBackfillResult {
  readonly candidate: SteamAppIdBackfillCandidate;
  /** El appid que dio IGDB, o null si no salió en la respuesta ("no está en Steam"). */
  readonly appId: number | null;
}

export interface SteamAppIdBackfillApplied {
  readonly found: number;
  readonly empty: number;
  readonly skipped: number;
  /** Juegos cuyo appid automático cambió de producto (raro aquí): re-encolar sus logros. */
  readonly correctedGameIds: readonly string[];
}

/** Aplica un lote en UNA transacción (los lotes son atómicos, como hoy). */
export function applySteamAppIdBackfill(
  ctx: QueryContext,
  results: readonly SteamAppIdBackfillResult[],
): SteamAppIdBackfillApplied {
  return ctx.store.transaction(() => {
    let found = 0;
    let empty = 0;
    let skipped = 0;
    const corrected: string[] = [];
    for (const { candidate, appId } of results) {
      const current = readLiveIdentity(ctx, candidate.gameId);
      if (
        !current ||
        current.steamAppIdSource === 'manual' ||
        current.igdbId !== candidate.igdbId ||
        current.steamAppId !== candidate.steamAppId
      ) {
        skipped++;
        continue;
      }
      if (appId === null) {
        recordCheck(ctx, current.id, 'steam_appid', 'empty');
        empty++;
        continue;
      }
      if (current.steamAppId !== null && current.steamAppId !== appId) {
        // Cambio de producto: lo de Steam guardado era del otro (como al corregir).
        forgetSteamProductChecks(ctx, current.id);
        writeMetadata(ctx, current, STEAM_FIELDS_CLEARED);
        corrected.push(current.id);
      }
      setAutoSteamAppId(ctx, current, appId);
      recordCheck(ctx, current.id, 'steam_appid', 'ok');
      found++;
    }
    return { found, empty, skipped, correctedGameIds: corrected };
  });
}
