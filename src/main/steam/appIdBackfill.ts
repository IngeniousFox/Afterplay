import { appCtx } from '../db/v2/appDb';
import {
  applySteamAppIdBackfill,
  selectSteamAppIdBackfillCandidates,
} from '../db/v2/queries/external';
import { getSteamAppIds } from '../igdb/api';

// Backfill del appid de Steam (LOGROS.md) — el "regenerado hacia atrás" para
// los juegos que ya existían antes de la columna: TODOS, planeados y
// normales, porque el appid es identidad del juego, no de su estado. Los
// juegos nuevos no pasan por aquí (nacen con él, ver resolveGameEnrichment);
// esto solo recoge a los pendientes (steamAppIdCheckedAt IS NULL), así que
// tras la primera pasada completa es un no-op instantáneo en cada arranque.
//
// Se lanza encadenado tras el PRIMER sync (main/index.ts), igual que los
// recaps y por el mismo motivo: si el otro PC ya hizo el backfill, el sync
// baja los appids y aquí no queda nada que preguntar.

// Muy por debajo del limit 500 de IGDB por respuesta: un juego puede tener
// VARIAS entradas de Steam (ediciones, paquetes regionales), así que las
// filas devueltas pueden superar a los juegos pedidos. Con 150 hay margen de
// sobra para que ninguna respuesta salga cortada (getSteamAppIds avisa si
// aun así tocara techo), y la biblioteca entera son 2-3 peticiones.
const BATCH_SIZE = 150;

export const runSteamAppIdBackfill = async (): Promise<void> => {
  // Sin credenciales de IGDB no hay a quién preguntar — se queda todo
  // pendiente (checkedAt null) y se reintenta cuando las haya.
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return;

  try {
    // isNotNull(igdbId): el appid se resuelve PREGUNTÁNDOLE a IGDB, así que un
    // juego sin ficha allí (existe en Steam y ellos aún no lo tienen) no puede
    // pasar por aquí. Se queda sin marcar a propósito — el día que IGDB lo
    // añada y el juego gane su id, esta pasada lo recogerá sola.
    const withIgdbId = selectSteamAppIdBackfillCandidates(appCtx());
    if (withIgdbId.length === 0) return;

    let found = 0;
    for (let start = 0; start < withIgdbId.length; start += BATCH_SIZE) {
      const batch = withIgdbId.slice(start, start + BATCH_SIZE);
      const appIds = await getSteamAppIds(batch.map((game) => game.igdbId));
      // La escritura relee cada juego: un appid fijado a mano mientras tanto no se pisa.
      const applied = applySteamAppIdBackfill(
        appCtx(),
        batch.map((candidate) => ({ candidate, appId: appIds.get(candidate.igdbId) ?? null })),
      );
      found += applied.found;
    }

    console.log(`[steam] backfill de appids: ${found}/${withIgdbId.length} juegos estan en Steam`);
  } catch (error) {
    // IGDB caído o sin red: nada queda a medias (los lotes son atómicos) y
    // los no marcados se reintentan solos en el próximo arranque.
    console.warn('[steam] fallo en el backfill de appids (se reintentara):', error);
  }
};
