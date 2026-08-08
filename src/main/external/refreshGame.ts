import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { updateGame } from '../db/queries/games/updateGame';
import { gamesTable } from '../db/schema';
import { getHltbTimes } from '../hltb/api';
import { getGameDetails, resolveAchievementsSteamAppId } from '../igdb/api';
import type { GameFullRefreshResult } from '../igdb/types';
import type { UpdateGamePatch } from '../../shared/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { getSteamGameData } from './steamData';

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
//    dato viejo vale más que ninguno.
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
  gameId: number,
): Promise<GameFullRefreshResult | null> => {
  const [game] = await withDbAccess(async () =>
    getDb()
      .select({
        igdbId: gamesTable.igdbId,
        title: gamesTable.title,
        releaseYear: gamesTable.releaseYear,
        steamAppId: gamesTable.steamAppId,
      })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1),
  );
  if (!game) return null;

  const patch: UpdateGamePatch = {};
  const now = new Date();

  // ── 1. IGDB: notas, sinopsis, sagas y fecha completa ────────────────────
  // Va primero y sola porque los demás dependen de lo que traiga: el título y
  // el año con los que se busca en HowLongToBeat, y el appid que lleva atado.
  const detail = await getGameDetails(game.igdbId).catch((error) => {
    console.warn('[refresh] IGDB no contesto para este juego (sigo con el resto):', error);
    return undefined;
  });

  // Tres estados distintos y hay que distinguirlos: contestó (undefined es
  // que falló la red; null es que el juego ya no está en su catálogo).
  const igdb: GameFullRefreshResult['igdb'] =
    detail === undefined ? 'failed' : detail === null ? 'gone' : 'updated';

  if (detail) {
    patch.ratingCritics = detail.ratingCritics;
    patch.ratingCriticsCount = detail.ratingCriticsCount;
    patch.ratingUsers = detail.ratingUsers;
    patch.ratingUsersCount = detail.ratingUsersCount;
    patch.summary = detail.summary;
    patch.igdbCollections = detail.igdbCollections;
    patch.releaseDate = detail.release?.date ?? null;
    patch.releaseDatePrecision = detail.release?.precision ?? null;
    // releaseYear se refresca pero NUNCA se pone a null: de él dependen las
    // stats y el matching de HowLongToBeat (misma regla que en refresh.ts).
    if (detail.releaseYear !== null) patch.releaseYear = detail.releaseYear;
    patch.ratingsCheckedAt = now;
  }

  // ── 2. HowLongToBeat y el appid, a la vez ───────────────────────────────
  // Son independientes entre sí y los dos pueden tardar, así que se pagan en
  // paralelo en vez de en fila.
  const [times, resolvedAppId] = await Promise.all([
    getHltbTimes(detail?.title ?? game.title, detail?.releaseYear ?? game.releaseYear).catch(
      (error) => {
        console.warn('[refresh] HowLongToBeat no contesto (sigo sin sus tiempos):', error);
        return undefined;
      },
    ),
    // El appid solo se busca si NO lo tiene: teniéndolo, es identidad del
    // juego y no se re-resuelve por gusto. Sin el detalle de IGDB no hay con
    // qué buscarlo (hace falta su parent_game y su entrada directa).
    game.steamAppId !== null || !detail
      ? Promise.resolve(undefined)
      : resolveAchievementsSteamAppId(
          detail.igdbId,
          detail.parentIgdbId,
          detail.directSteamAppId,
        ).catch((error) => {
          console.warn('[refresh] no se pudo resolver el appid de Steam:', error);
          return undefined;
        }),
  ]);

  const hltb: GameFullRefreshResult['hltb'] =
    times === undefined ? 'failed' : times === null ? 'no-match' : 'updated';
  if (times) {
    patch.hltbMain = times.hltbMain;
    patch.hltbMainExtras = times.hltbMainExtras;
    patch.hltbCompletionist = times.hltbCompletionist;
  }

  const steam: GameFullRefreshResult['steam'] =
    game.steamAppId !== null
      ? 'had-it'
      : resolvedAppId === undefined
        ? 'failed'
        : resolvedAppId === null
          ? 'not-on-steam'
          : 'found';
  if (steam === 'found' && resolvedAppId) {
    patch.steamAppId = resolvedAppId;
    patch.steamAppIdCheckedAt = now;
  }

  // ── 3. Steam: etiquetas y reseñas ───────────────────────────────────────
  // Con el appid que sea: el de siempre o el que acaba de aparecer — que sea
  // nuevo es justo el caso en el que estas dos cosas llegan por primera vez.
  const appId = game.steamAppId ?? (steam === 'found' ? resolvedAppId : null);
  let steamSpy: GameFullRefreshResult['steamSpy'] = 'skipped';
  if (appId) {
    const data = await getSteamGameData(appId);
    // Las dos fuentes se tragan sus propios errores y devuelven null, así que
    // aquí "no hay dato" y "no contestó" son lo mismo — y en los dos casos se
    // conserva lo que hubiera.
    steamSpy = data ? 'updated' : 'no-data';
    if (data) {
      Object.assign(patch, data);
      patch.steamSpyCheckedAt = now;
    }
  }

  // ── 4. Escritura, con todo lo que se haya reunido ───────────────────────
  await withDbAccess(async () => updateGame(gameId, patch));

  // ── 5. Los logros, al final y por su cola ───────────────────────────────
  // Después de escribir a propósito: si el appid acaba de aparecer, este es
  // el momento en el que el juego tiene logros por primera vez — y la cola
  // lee el appid de la base de datos, no de aquí.
  const achievements = await queueAchievementsRefreshForGame(gameId, {
    // Sin aviso flotante, mismo criterio que el botón de la sección de
    // logros: lo has pedido tú mirando la ficha y la ficha se actualiza sola
    // delante de ti.
    notify: false,
    forceRaRematch: true,
  }).catch((error) => {
    console.warn('[refresh] fallo refrescando los logros:', error);
    return undefined;
  });

  return {
    igdb,
    hltb,
    steam,
    steamSpy,
    achievements: achievements === undefined ? 'failed' : achievements ? 'queued' : 'nothing',
  };
};
