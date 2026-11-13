import type { QueryContext } from '../common/context';
import {
  hasSteamData,
  readLiveIdentity,
  recordCheck,
  steamFields,
  writeMetadata,
} from './internal';
import type { SteamStoreData } from './types';

// Etiquetas y reseñas de Steam de un juego recién dado de alta
// (`external/warmNewGame.ts`, `warmSteamData`). Fire-and-forget en el
// llamador: `getSteamGameData(appId)` y después esto.
//
// La guarda de la 1.x estaba en el WHERE (`steamAppId = appId`); aquí se
// relee dentro de la transacción: si el appid ya no es ese (lo cambiaste a
// mano justo después del alta) o el juego se borró, no se escribe nada.
//
// `warmImageCache` no toca la base: recibe la carátula y el banner EFECTIVOS
// (`readGameRow(ctx, id).coverUrl/heroUrl`, override ?? caché).

export type WarmSteamOutcome = 'written' | 'empty' | 'skipped';

export function applyWarmSteamData(
  ctx: QueryContext,
  gameId: string,
  appId: number,
  data: SteamStoreData | null,
): WarmSteamOutcome {
  return ctx.store.transaction((): WarmSteamOutcome => {
    const current = readLiveIdentity(ctx, gameId);
    if (!current || current.steamAppId !== appId) return 'skipped';
    if (!hasSteamData(data)) {
      // Hoy no dejaba marca; ahora `empty`, sin cambiar a quién se pregunta.
      recordCheck(ctx, gameId, 'steam_store', 'empty');
      return 'empty';
    }
    writeMetadata(ctx, current, steamFields(data));
    recordCheck(ctx, gameId, 'steam_store', 'ok');
    return 'written';
  });
}
