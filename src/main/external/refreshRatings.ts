import { appCtx } from '../db/v2/appDb';
import {
  applyRatingsRefreshResult,
  igdbDetailToBatch,
  readExternalSnapshot,
  type AppIdResolution,
} from '../db/v2/queries/external';
import { getGameDetails, resolveAchievementsSteamAppId } from '../igdb/api';
import type { GameRatings, RatingsRefreshResult } from '../igdb/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { getSteamReviewCounts } from '../steam/reviews';
import { findSteamAppIdFix } from './steamAppIdFix';
import type { GameId } from '../../shared/entityIds';

// El ⟳ de la card "Ratings" de la ficha — las TRES notas que esa card enseña.
//
// Nació preguntándole solo a IGDB (se llamaba igdb:refreshRatings) porque
// entonces la card tenía dos tiles y los dos eran suyos. Al entrar el tile de
// STEAM quedó un botón de refrescar que dejaba fuera a un tercio de lo que
// tenía debajo: pulsabas, la crítica y los jugadores se movían, y el % de
// Steam se quedaba clavado sin decir por qué. Un botón de refrescar refresca
// lo que se ve encima, o miente.
//
// Sigue SIN ser el botón de "actualiza este juego entero" (ese está en la
// barra de acciones, ver refreshGame.ts): aquí no entran ni HowLongToBeat ni
// los logros, que no son notas y no salen en esta card. La única vez que esto
// roza los logros es cuando el appid resulta ser de OTRO producto y se
// corrige — ver el final, donde se explica por qué eso no es refrescarlos.
//
// De paso guarda todo lo que el detalle de IGDB ya trae en la MISMA respuesta
// —sinopsis, sagas, fecha completa con su precisión— porque pedirlo cuesta
// cero y dejarlo sin guardar sería tirar el viaje a medias. Lo que se DEVUELVE
// siguen siendo solo las notas, que es lo único que la card necesita.
//
// Los tramos que tocan la DB van cada uno en su withDbAccess, con la red
// FUERA: retener el candado durante una llamada a internet bloquearía un swap
// de conexión en caliente por una espera que no tiene nada que ver con la
// base de datos.
//
// null = ese juego ya no está en la biblioteca.
export const refreshGameRatings = async (gameId: GameId): Promise<RatingsRefreshResult | null> => {
  // La foto sin transacción; la red va fuera y la escritura relee.
  const game = readExternalSnapshot(appCtx(), gameId);
  if (!game) return null;
  const manualAppId = game.steamAppIdSource === 'manual';

  const detail = game.igdbId === null ? null : await getGameDetails(game.igdbId);
  let ratings: GameRatings | null = null;
  if (detail) {
    ratings = {
      ratingCritics: detail.ratingCritics,
      ratingCriticsCount: detail.ratingCriticsCount,
      ratingUsers: detail.ratingUsers,
      ratingUsersCount: detail.ratingUsersCount,
    };
  }

  // El appid se busca o se revisa con el detalle recién traído (nunca uno
  // elegido a mano): un appid nuevo o corregido entra en la misma escritura.
  let appId = game.steamAppId;
  let appIdResolution: AppIdResolution | undefined;
  if (detail && !manualAppId) {
    const igdbId = detail.igdbId;
    if (appId === null) {
      const found = await resolveAchievementsSteamAppId(
        igdbId,
        detail.parentIgdbId,
        detail.directSteamAppId,
      ).catch(() => null);
      if (found !== null) {
        appId = found;
        appIdResolution = { kind: 'found', appId: found };
      }
    } else {
      const better = await findSteamAppIdFix({ igdbId, steamAppId: appId, title: game.title });
      if (better !== undefined) {
        appId = better;
        appIdResolution = { kind: 'corrected', appId: better };
      }
    }
  }

  let steam: RatingsRefreshResult['steam'] = 'skipped';
  let reviews: Awaited<ReturnType<typeof getSteamReviewCounts>> | undefined;
  if (appId !== null) {
    reviews = await getSteamReviewCounts(appId);
    steam = reviews ? 'updated' : 'no-data';
  }

  const outcome = applyRatingsRefreshResult(appCtx(), game, {
    ...(game.igdbId === null ? {} : { igdb: detail ? igdbDetailToBatch(detail) : null }),
    ...(appIdResolution ? { appId: appIdResolution } : {}),
    ...(reviews === undefined ? {} : { reviews }),
  });

  if (outcome.status === 'applied' && outcome.appIdChanged === 'corrected') {
    await queueAchievementsRefreshForGame(gameId, { notify: false }).catch((error: unknown) => {
      console.warn('[refresh] no se pudieron re-encolar los logros del appid corregido:', error);
      return false;
    });
  }
  return { ratings, steam };
};
