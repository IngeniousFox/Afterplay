import { appCtx } from '../db/v2/appDb';
import {
  applyRefreshGameResult,
  failed,
  igdbDetailToBatch,
  isFailure,
  readExternalSnapshot,
  type AppIdResolution,
  type SteamStoreData,
} from '../db/v2/queries/external';
import { getHltbTimes } from '../hltb/api';
import { getGameDetails, resolveAchievementsSteamAppId } from '../igdb/api';
import type { GameFullRefreshResult } from '../igdb/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { resolveSgdbId } from '../sgdb/api';
import { adoptIgdbForGame } from './adoptIgdb';
import { findSteamAppIdFix } from './steamAppIdFix';
import { getSteamGameData } from './steamData';
import type { GameId } from '../../shared/entityIds';

// "Actualízalo TODO" de UN juego — el botón de su ficha.
//
// Por qué hace falta, aunque cada dato ya tenga su propio botón: los datos
// externos de un juego venían de cuatro sitios distintos, cada uno con su
// gesto, su sitio y su regla de cuándo se puede pedir — las notas en la card
// de Ratings, los tiempos en la de How long to beat, los logros en su
// sección, y las etiquetas y reseñas de Steam en NINGÚN sitio (solo el
// barrido de la biblioteca entera, que dura minutos). Para poner al día un
// juego concreto había que acordarse de los cuatro, encontrarlos, y aun así
// quedarse sin lo de Steam.
//
// Esto es el mismo trabajo, en un clic: exactamente lo que hace la pasada de
// biblioteca (refresh.ts) pero para un juego, MÁS los logros, que la pasada
// no toca. Y va directo, sin cola ni progreso: son cuatro peticiones a la
// vez, no trescientas en serie — segundos, no minutos.
//
// Las convenciones de la casa se respetan igual que en la pasada grande:
//  · La RED va SIEMPRE fuera del candado de la DB.
//  · Una sola escritura al final, con todo lo que se haya podido reunir.
//  · Un "no" de una fuente NUNCA borra lo que ya había: si HLTB hoy no
//    reconoce el juego, se conserva lo que sí encontró el día del alta. Un
//    dato viejo vale más que ninguno. La única excepción está en el paso 3 y
//    no es una excepción de verdad: cuando el appid se corrige, lo guardado
//    de Steam era de OTRO producto, no un dato viejo de este juego.
//  · Cada fuente se cae SOLA: que IGDB no conteste no puede llevarse por
//    delante los logros ni las etiquetas. Por eso cada pata tiene su catch y
//    su propio veredicto en el resultado — un refresco "a medias" es lo
//    normal aquí, no un fallo, y hay que poder contarlo tal cual.
//
// Lo que a propósito NO entra:
//  · Las curiosidades del modo ambiente: se generan UNA vez en la vida con
//    un modelo de pago (ver memories/generate.ts). Meterlas aquí sería gastar
//    dinero en cada clic de un botón que invita a pulsarlo.
//  · La carátula y el hero: no son un dato que se refresque, son una
//    ELECCIÓN tuya del CoverPicker. Volver a pedirlos podría cambiarte la
//    portada que elegiste a mano.
export const refreshGameEverything = async (
  gameId: GameId,
): Promise<GameFullRefreshResult | null> => {
  // 1. La foto del juego, sin transacción: la red va después y fuera.
  let snapshot = readExternalSnapshot(appCtx(), gameId);
  if (!snapshot) return null;

  // La adopción de IGDB va primero y escribe por su cuenta: a partir de aquí
  // el juego es de IGDB y el resto del refresco ya pregunta con su igdbId.
  let adopted = false;
  if (snapshot.igdbId === null && snapshot.steamAppId !== null) {
    if ((await adoptIgdbForGame(gameId, snapshot.steamAppId)) !== null) {
      adopted = true;
      snapshot = readExternalSnapshot(appCtx(), gameId);
      if (!snapshot) return null;
    }
  }
  const game = snapshot;
  const manualAppId = game.steamAppIdSource === 'manual';

  // 2. La red, cada fuente con su propio catch.
  const detail =
    game.igdbId === null
      ? null
      : await getGameDetails(game.igdbId).catch((error) => {
          console.warn('[refresh] IGDB no contesto para este juego (sigo con el resto):', error);
          return undefined;
        });
  const igdb: GameFullRefreshResult['igdb'] =
    detail === undefined ? 'failed' : detail === null ? 'gone' : 'updated';

  const [times, resolvedAppId, appIdFix] = await Promise.all([
    getHltbTimes(detail?.title ?? game.title, detail?.releaseYear ?? game.releaseYear).catch(
      (error: unknown) => {
        console.warn('[refresh] HowLongToBeat no contesto (sigo sin sus tiempos):', error);
        return failed(error);
      },
    ),
    manualAppId || game.steamAppId !== null || !detail
      ? Promise.resolve(undefined)
      : resolveAchievementsSteamAppId(
          detail.igdbId,
          detail.parentIgdbId,
          detail.directSteamAppId,
        ).catch((error) => {
          console.warn('[refresh] no se pudo resolver el appid de Steam:', error);
          return undefined;
        }),
    manualAppId || game.steamAppId === null || !detail
      ? Promise.resolve(undefined)
      : findSteamAppIdFix({
          igdbId: detail.igdbId,
          steamAppId: game.steamAppId,
          title: game.title,
        }),
  ]);
  const hltb: GameFullRefreshResult['hltb'] = isFailure(times)
    ? 'failed'
    : times === null
      ? 'no-match'
      : 'updated';

  const steam: GameFullRefreshResult['steam'] =
    game.steamAppId !== null
      ? 'had-it'
      : resolvedAppId === undefined
        ? 'failed'
        : resolvedAppId === null
          ? 'not-on-steam'
          : 'found';
  let appIdResolution: AppIdResolution | undefined;
  if (appIdFix !== undefined) appIdResolution = { kind: 'corrected', appId: appIdFix };
  else if (steam === 'found' && resolvedAppId) {
    appIdResolution = { kind: 'found', appId: resolvedAppId };
  } else if (steam === 'not-on-steam') appIdResolution = { kind: 'not-on-steam' };

  const appId = appIdFix ?? game.steamAppId ?? (steam === 'found' ? resolvedAppId : null);
  let steamSpy: GameFullRefreshResult['steamSpy'] = 'skipped';
  let steamData: SteamStoreData | null | undefined;
  if (appId) {
    steamData = await getSteamGameData(appId);
    steamSpy = steamData ? 'updated' : 'no-data';
  }

  let sgdbId: number | null | undefined;
  if (game.sgdbId === null) {
    sgdbId = await resolveSgdbId({
      title: detail?.title ?? game.title,
      releaseYear: detail?.releaseYear ?? game.releaseYear,
      steamAppId: appId ?? null,
    });
  }

  // 3. Una sola escritura, que relee el juego y descarta lo que cambió
  // mientras tanto (un appid fijado a mano, un id de SteamGridDB elegido…).
  applyRefreshGameResult(appCtx(), game, {
    ...(game.igdbId === null
      ? {}
      : {
          igdb:
            detail === undefined ? failed() : detail === null ? null : igdbDetailToBatch(detail),
        }),
    hltb: times ?? null,
    ...(appIdResolution ? { appId: appIdResolution } : {}),
    ...(appId ? { steam: steamData ?? null } : {}),
    ...(sgdbId === undefined ? {} : { sgdbId }),
  });

  // Los logros siempre (también si no cambió nada de lo de arriba), DESPUÉS de
  // confirmar la escritura: un appid corregido tiene que verse ya.
  const achievements = await queueAchievementsRefreshForGame(gameId, {
    notify: false,
    forceRaRematch: true,
  }).catch((error) => {
    console.warn('[refresh] fallo refrescando los logros:', error);
    return undefined;
  });

  return {
    igdb: adopted ? 'adopted' : igdb,
    hltb,
    steam,
    steamSpy,
    achievements: achievements === undefined ? 'failed' : achievements ? 'queued' : 'nothing',
  };
};
