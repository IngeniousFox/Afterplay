import { and, eq, isNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getHltbTimes } from '../hltb/api';
import { getGameDetails, resolveAchievementsSteamAppId } from '../igdb/api';
import type { GameFullRefreshResult } from '../igdb/types';
import type { UpdateGamePatch } from '../../shared/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { resolveSgdbId } from '../sgdb/api';
import { adoptIgdbForGame } from './adoptIgdb';
import { findSteamAppIdFix } from './steamAppIdFix';
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
  gameId: number,
): Promise<GameFullRefreshResult | null> => {
  const [game] = await withDbAccess(async () =>
    getDb()
      .select({
        igdbId: gamesTable.igdbId,
        title: gamesTable.title,
        releaseYear: gamesTable.releaseYear,
        steamGridDbId: gamesTable.steamGridDbId,
        steamAppId: gamesTable.steamAppId,
        steamAppIdManual: gamesTable.steamAppIdManual,
      })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1),
  );
  if (!game) return null;

  // ── 0. ¿Ya lo tiene IGDB? ───────────────────────────────────────────────
  // Antes que nada, y solo para los que se dieron de alta solo con Steam: si
  // IGDB por fin lo ha metido, el juego cambia de fuente AQUÍ y el resto del
  // refresco sigue ya con su ficha buena, no con la provisional de la tienda
  // (ver external/adoptIgdb.ts).
  let igdbId = game.igdbId;
  let adopted = false;
  if (igdbId === null && game.steamAppId !== null) {
    const found = await adoptIgdbForGame(gameId, game.steamAppId);
    if (found !== null) {
      igdbId = found;
      adopted = true;
    }
  }

  const patch: UpdateGamePatch = {};
  const now = new Date();

  // ── 1. IGDB: notas, sinopsis, sagas y fecha completa ────────────────────
  // Va primero y sola porque los demás dependen de lo que traiga: el título y
  // el año con los que se busca en HowLongToBeat, y el appid que lleva atado.
  // igdbId null = este juego no está en el catálogo de IGDB (existe en Steam
  // pero IGDB todavía no lo tiene). No hay a quién preguntar, así que se trata
  // igual que un "ya no está en el catálogo": ni se pide, ni se pisa nada.
  const detail =
    igdbId === null
      ? null
      : await getGameDetails(igdbId).catch((error) => {
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
  const [times, resolvedAppId, appIdFix] = await Promise.all([
    getHltbTimes(detail?.title ?? game.title, detail?.releaseYear ?? game.releaseYear).catch(
      (error) => {
        console.warn('[refresh] HowLongToBeat no contesto (sigo sin sus tiempos):', error);
        return undefined;
      },
    ),
    // El appid solo se busca si NO lo tiene: teniéndolo, es identidad del
    // juego y no se re-resuelve por gusto. Sin el detalle de IGDB no hay con
    // qué buscarlo (hace falta su parent_game y su entrada directa).
    //
    // La excepción es un appid que apunta DONDE NO DEBE: a una beta cerrada
    // —sin tienda, sin etiquetas y sin logros— o directamente a otro producto,
    // y ninguno de los dos es la identidad de nada. Se comprueba contra las
    // entradas de Steam de su propia ficha y se corrige solo en esos dos casos
    // (external/steamAppIdFix.ts, que es de donde sale también el aviso por
    // consola).
    game.steamAppIdManual || game.steamAppId !== null || !detail
      ? Promise.resolve(undefined)
      : resolveAchievementsSteamAppId(
          detail.igdbId,
          detail.parentIgdbId,
          detail.directSteamAppId,
        ).catch((error) => {
          console.warn('[refresh] no se pudo resolver el appid de Steam:', error);
          return undefined;
        }),
    game.steamAppIdManual || game.steamAppId === null || !detail
      ? Promise.resolve(undefined)
      : findSteamAppIdFix({
          igdbId: detail.igdbId,
          steamAppId: game.steamAppId,
          title: game.title,
        }),
  ]);

  const hltb: GameFullRefreshResult['hltb'] =
    times === undefined ? 'failed' : times === null ? 'no-match' : 'updated';
  if (times) {
    // Tramo a tramo, y SOLO los que HLTB supo: escribir los tres en bloque
    // borraba lo que ya había. getHltbTimes solo descarta el match cuando los
    // TRES vienen null, así que un match parcial (una ficha de HLTB con un
    // único tramo enviado, o la que elige findBestMatch cuando la buena no
    // existe) entraba entero y sus dos null pisaban el "main extras" y el
    // "completionist" del día del alta — justo lo contrario de la regla de la
    // cabecera de este fichero: un "no" de una fuente NUNCA borra lo que ya
    // había. Mismo criterio que mergeSteamPatch con las etiquetas y las
    // reseñas (external/steamData.ts).
    if (times.hltbMain !== null) patch.hltbMain = times.hltbMain;
    if (times.hltbMainExtras !== null) patch.hltbMainExtras = times.hltbMainExtras;
    if (times.hltbCompletionist !== null) patch.hltbCompletionist = times.hltbCompletionist;
  }

  // 'had-it' mira el appid con el que EMPEZÓ el refresco, así que un juego al
  // que se le acaba de corregir (appIdFix, unas líneas más abajo) sale también
  // por aquí. El dato para distinguirlo ya está resuelto y a mano; lo que
  // falta es DÓNDE ponerlo: la unión de GameFullRefreshResult (igdb/types.ts)
  // no tiene miembro para "lo tenía y era de otro juego", y estrenarlo sin la
  // frase que lo cuente en el renderer (useRefreshGame.ts) cambia una etiqueta
  // muda por otra — el toast cae igual al titular genérico. Hasta que entren
  // los tres cambios a la vez, el único rastro del cambio de identidad es el
  // aviso por consola del helper y lo que se escribe aquí debajo.
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
  // El appid guardado no era el de este juego y su ficha tiene el bueno.
  if (appIdFix !== undefined) {
    patch.steamAppId = appIdFix;
    patch.steamAppIdCheckedAt = now;
  }

  // ── 3. Steam: etiquetas y reseñas ───────────────────────────────────────
  // Con el appid que sea: el de siempre, el corregido, o el que acaba de
  // aparecer — que sea nuevo es justo el caso en el que estas dos cosas
  // llegan por primera vez. El corregido va DELANTE del guardado: si no, se
  // pedirían las etiquetas del juego equivocado, que es lo que se arregla.
  const appId = appIdFix ?? game.steamAppId ?? (steam === 'found' ? resolvedAppId : null);
  let steamSpy: GameFullRefreshResult['steamSpy'] = 'skipped';
  if (appId) {
    // Si el appid se ha CORREGIDO, lo guardado es de otro producto: a null
    // ANTES de pedir nada, para que lo que Steam conteste lo pise y lo que no
    // se quede vacío en vez de mentir. El caso real es el remake sin salir
    // ("Trails in the Sky 2nd Chapter" llevaba el appid del original de 2015):
    // su página existe, así que llegan etiquetas, pero aún no tiene ni una
    // reseña — y sin esto la ficha seguía enseñando los tres mil votos del
    // juego de 2015, ahora colgados del appid bueno. La regla de la casa ("un
    // no externo no borra lo que había") protege un dato de ESTE juego que
    // envejeció, y esos números nunca lo fueron.
    if (appIdFix !== undefined) {
      patch.steamTags = null;
      patch.steamPositive = null;
      patch.steamNegative = null;
    }
    const data = await getSteamGameData(appId);
    // Las dos fuentes se tragan sus propios errores y devuelven null, así que
    // aquí "no hay dato" y "no contestó" son lo mismo — y en los dos casos se
    // conserva lo que hubiera, salvo el appid corregido de aquí arriba, donde
    // "lo que hubiera" era de otro juego.
    steamSpy = data ? 'updated' : 'no-data';
    if (data) {
      Object.assign(patch, data);
      patch.steamSpyCheckedAt = now;
    }
  }

  // ── 3bis. El id de SteamGridDB, si le faltaba ───────────────────────────
  // Mismo caso que el id de IGDB: SteamGridDB tampoco tiene arte de un juego
  // el día que se anuncia. Si el alta se hizo demasiado pronto, aquí es donde
  // se recupera — y solo si falta: el que ya está puede ser el que elegiste tú
  // en el CoverPicker.
  if (game.steamGridDbId === null) {
    const sgdbId = await resolveSgdbId({
      title: detail?.title ?? game.title,
      releaseYear: detail?.releaseYear ?? game.releaseYear,
      steamAppId: appId ?? null,
    });
    if (sgdbId !== null) patch.steamGridDbId = sgdbId;
  }

  // ── 4. Escritura, con todo lo que se haya reunido ───────────────────────
  if (Object.keys(patch).length > 0) {
    await withDbAccess(async () =>
      getDb()
        .update(gamesTable)
        .set(patch)
        .where(
          and(
            eq(gamesTable.id, gameId),
            eq(gamesTable.steamAppIdManual, game.steamAppIdManual),
            game.steamAppId === null
              ? isNull(gamesTable.steamAppId)
              : eq(gamesTable.steamAppId, game.steamAppId),
          ),
        ),
    );
  }

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
    // La adopción manda sobre el veredicto normal: si el juego ACABA de
    // entrar en IGDB, eso es lo que hay que contar, no un "actualizado" que
    // suena a refresco rutinario.
    igdb: adopted ? 'adopted' : igdb,
    hltb,
    steam,
    steamSpy,
    achievements: achievements === undefined ? 'failed' : achievements ? 'queued' : 'nothing',
  };
};
