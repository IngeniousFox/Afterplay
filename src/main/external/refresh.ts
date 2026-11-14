import { appCtx } from '../db/v2/appDb';
import {
  applyRefreshPass,
  failed,
  needsAppIdLookup,
  needsAppIdReview,
  selectHltbOrphans,
  selectRefreshTargets,
  type AppIdResolution,
  type HltbTimesData,
  type RefreshPassItem,
  type RefreshTarget,
  type SourceFailure,
} from '../db/v2/queries/external';
import { getHltbTimes } from '../hltb/api';
import { getGameExternalBatch, getSteamAppIds } from '../igdb/api';
import type { ExternalRefreshSummary } from '../igdb/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { getSteamReviewCounts, STEAM_REVIEWS_DELAY_MS } from '../steam/reviews';
import { getSteamTags } from '../steam/tags';
import { adoptIgdbForCandidates, findAdoptionCandidates } from './adoptIgdb';
import { fillMissingSgdbIds } from './sgdbBackfill';
import { notifyExternalActivity } from './notify';
import { findSteamAppIdFixes } from './steamAppIdFix';
import { mergeSteamPatch, type SteamGamePatch } from './steamData';
import type { GameId } from '../../shared/entityIds';

// Datos externos de la biblioteca (PLAN-TO-PLAY.md §5): UN solo mecanismo con
// DOS puertas — el botón de la cabecera del Plan (solo los planeados, la
// puerta del día a día) y el de Ajustes (biblioteca entera, mantenimiento).
// Los dos llaman aquí; lo único que cambia es a qué juegos alcanza.
//
// Qué se refresca y qué NO:
//  · IGDB, 1-2 peticiones por lotes: notas, sinopsis, sagas y la fecha
//    completa con su precisión. Todo del mismo viaje.
//  · El APPID de Steam de los que aún no lo tienen — ver más abajo, es la
//    puerta de todo lo de Steam y hasta ahora era irrepetible.
//  · Steam, solo para juegos con appid: etiquetas (por lotes) y reseñas
//    (una a una) — ver external/steamData.ts.
//  · HowLongToBeat, SOLO para los HUÉRFANOS: los juegos con los tres
//    tiempos a null. La biblioteca entera sigue fuera a propósito (§5.2):
//    sin API de lotes, con matching difuso y una API no oficial, 300 juegos
//    serían una ráfaga frágil de fallos mudos — para refrescar un tiempo que
//    YA existe está el botón de la ficha. Pero un juego sin tiempos no tiene
//    nada que un mal match pueda pisar, y nadie va a recorrer la biblioteca
//    ficha a ficha buscando cuáles son: son los que HLTB no conocía el día
//    del alta (nicho, sin salir) o los que cayeron en una avería como la de
//    ago-2026 (/api/bleed muerto y el alta siguió sin tiempos, como debe).
//    Sin esta repesca, esos null eran PARA SIEMPRE — y la Deuda del Backlog,
//    que suma estos tiempos, quedaba corta en silencio. Van uno a uno con
//    pausa, y si HLTB está caído se rinde tras unos pocos fallos seguidos en
//    vez de insistir con la lista entera.
//
// ── Por qué el estado de la pasada vive AQUÍ y no en el componente ──────────
//
// Las reseñas se piden juego a juego: con la biblioteca
// entera son MINUTOS. En ese rato el usuario cierra Ajustes, se va a otra
// pantalla o abre el Plan — y con el estado en un useMutation del componente,
// cada desmontaje se llevaba por delante el "Refreshing…" aunque el trabajo
// siguiera corriendo tan tranquilo en el main. Consecuencias reales: el botón
// volvía a parecer disponible y un segundo clic arrancaba una pasada
// duplicada.
//
// Mismo patrón que las otras pasadas largas de la casa (curiosidades, logros,
// redescarga de imágenes): el candado y el progreso son del MAIN, viajan por
// un canal de eventos, y la UI solo los pinta. Así da igual desde dónde se
// arranque y dónde estés mirando cuando termine.

// Convenciones de la casa que se respetan aquí, todas por el mismo motivo:
//  · La RED va SIEMPRE fuera del candado de la DB (withDbAccess) — retenerlo
//    durante una llamada a internet bloquearía un swap de conexión en
//    caliente por una espera que no tiene nada que ver con la base de datos.
//  · Y ANTES de escribir nada: si IGDB falla a mitad de los lotes, no se ha
//    tocado ni una fila.
//  · Un "no" de una fuente externa nunca borra lo que ya había: se estampa el
//    checkedAt y lo viejo se queda. Un dato de hace un mes vale más que nada.

// ── Por qué el appid se vuelve a preguntar AQUÍ ─────────────────────────────
//
// El appid es la PUERTA de todo lo de Steam: sin él no hay etiquetas, no hay
// reseñas y no hay logros. Se resuelve en el alta (resolveGameEnrichment) y,
// para los juegos anteriores a la columna, en el backfill de arranque
// (steam/appIdBackfill.ts). Pero ese backfill solo recoge a los que tienen
// `steamAppIdCheckedAt IS NULL` — es decir, un "no está en Steam" quedaba
// grabado PARA SIEMPRE en cuanto se preguntaba una vez.
//
// Y ese "no" caduca. El caso real que lo destapó: un juego dado de alta ANTES
// de salir (un Plan to Play, o un lanzamiento reciente) todavía no tiene su
// entrada de Steam enlazada en IGDB — external_games se rellena alrededor del
// lanzamiento. Se le preguntaba el primer día, se estampaba null, y ya nunca
// más: el juego salía, acumulaba miles de reseñas, y en la app seguía siendo
// para siempre "un juego que no está en Steam". Sin etiquetas y sin el % de
// reseñas, sin ningún hueco que lo explicara, y sin más botón que pulsar —
// porque ningún botón volvía a preguntarlo.
//
// Así que el refresco general, que es justo el botón de "ponlo todo al día",
// re-pregunta el appid de los que aún no lo tienen. Es barato: getSteamAppIds
// va por lotes de 150 y la biblioteca entera son 2-3 peticiones, escondidas
// detrás de la pasada de reseñas, que dura minutos.
//
// Y desde el 9-ago-2026 mira TAMBIÉN a los que ya tienen appid, para dos
// casos y ni uno más (los dos los decide findSteamAppIdCorrections, en
// igdb/api.ts):
//  · Que sea el appid de un PLAYTEST del propio juego. IGDB enlaza a menudo
//    dos entradas al mismo juego —"Atomic Heart" y "Atomic Heart Playtest"— y
//    quedarse con la beta cerrada deja al juego sin tienda, sin etiquetas y
//    sin logros (38 juegos de 952 en la biblioteca real).
//  · Que apunte a OTRO producto, o sea que ni siquiera figure entre las
//    entradas de Steam de su ficha. Cinco en la biblioteca real y todos el
//    mismo patrón: el appid del juego viejo en la ficha del nuevo ("Trails in
//    the Sky 2nd Chapter", el remake sin salir, con las tres mil reseñas del
//    original de 2015).
// Para todo lo demás sigue en pie lo de siempre: un appid bueno es identidad
// del juego y no se re-resuelve por gusto.

// Mismo tamaño que el backfill de arranque y por el mismo motivo (ver
// appIdBackfill.ts): un juego puede tener VARIAS entradas de Steam, así que
// las filas devueltas superan a los juegos pedidos y hace falta margen para
// no tocar el límite de 500 de IGDB.
const APPID_BATCH_SIZE = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// La repesca de HowLongToBeat va con más calma que las reseñas de Steam: es
// la API más frágil de todas las que toca la pasada (no oficial, con token
// anti-bot) y aquí no hay prisa — los huérfanos son un puñado, no un lote.
const HLTB_ORPHANS_DELAY_MS = 1_000;
// Tres fallos SEGUIDOS = HLTB está caído (o rotó su API otra vez, ver
// hltb/client.ts): seguir preguntando juego a juego sería exactamente la
// ráfaga de fallos mudos que motivó dejar a HLTB fuera de la pasada. Un fallo
// suelto no cuenta: un match raro o un timeout puntual no dicen nada del
// servicio.
const HLTB_ORPHANS_ABORT_AFTER = 3;

export type RefreshScope = 'plan' | 'all';

// igdbId null = juego que no está en el catálogo de IGDB (existe en Steam y
// ellos todavía no lo tienen). Entra igual en la pasada: lo de Steam sí se le
// puede pedir, solo se salta la parte de IGDB.
type TargetGame = RefreshTarget;

const EMPTY_SUMMARY: ExternalRefreshSummary = {
  total: 0,
  updated: 0,
  withRatings: 0,
  withSummary: 0,
  withFullDate: 0,
  adoptedFromSteam: 0,
  appIdsFound: 0,
  appIdsFixed: 0,
  steamChecked: 0,
  steamFound: 0,
  hltbChecked: 0,
  hltbFound: 0,
};

let running = false;

export const isExternalRefreshRunning = (): boolean => running;

const selectTargets = (scope: RefreshScope): TargetGame[] => selectRefreshTargets(appCtx(), scope);

export const startExternalRefresh = async (scope: RefreshScope): Promise<number> => {
  // Dos pasadas a la vez se pisarían las mismas filas y doblarían las
  // peticiones a un servicio gratuito que pide ir despacio.
  //
  // La guarda y la TOMA del candado van juntas y SIN await en medio. Estaban
  // separadas —el `running = true` vivía después de leer los juegos— y ese
  // hueco era real: `selectTargets` es un SELECT de la tabla entera que cede
  // el bucle de eventos y encima puede quedarse encolado tras otro trabajo de
  // DB. Un doble clic normal, o el clic del Plan mientras la pasada semanal
  // dispara la suya al arrancar, colaban dos pasadas a la vez — el doble de
  // peticiones contra un servicio gratuito, y la primera en acabar cantando
  // "done" con la otra todavía corriendo.
  //
  // Y que sigan pegadas no es solo cosa de aquí: el radar (radar/pass.ts) lee
  // isExternalRefreshRunning() en la línea de justo antes de llamar y sella su
  // semana según eso. Un await colado entre estas dos líneas se lleva por
  // delante esa garantía, no solo esta.
  if (running) return 0;
  running = true;

  // Con el candado ya tomado, TODO lo que pueda fallar antes de que runPass se
  // haga cargo tiene que soltarlo. Sin este try, un SELECT que rechace —la DB
  // en pleno swap de conexión, el disco lleno— dejaba `running` en true para
  // siempre, y "para siempre" aquí es literal: la app vive semanas en la
  // bandeja. A partir de ese momento ningún refresco volvía a arrancar, y el
  // radar —que solo sella la semana si el externo arrancó— repetía su pasada
  // entera cada hora sin sellarla nunca.
  let games: TargetGame[];
  try {
    games = selectTargets(scope);
  } catch (caught) {
    running = false;
    // Y se avisa como en un final normal: 'external:status' saca su `running`
    // de este candado, así que una pantalla que lo hubiera leído en este hueco
    // se queda pintando "Refreshing…". Cuando lo arranca un botón, su propia
    // mutación acaba refrescando el estado; cuando lo arranca el radar no hay
    // botón detrás, y este evento es lo único que la despierta.
    notifyExternalActivity({
      running: false,
      scope,
      phase: 'done',
      done: 0,
      total: 0,
      currentTitle: null,
      summary: null,
      error: caught instanceof Error ? caught.message : String(caught),
    });
    // Y se relanza: leer la lista es lo único que este invoke hace de verdad
    // antes de contestar, así que su fallo tiene que llegar al renderer
    // (ipc/external.ts cuenta con ello; el radar lo recoge en su .catch).
    throw caught;
  }

  if (games.length === 0) {
    // Salida temprana: hay que soltar el candado A MANO, porque runPass —que
    // es quien lo suelta en su finally— no llega a arrancar.
    running = false;
    notifyExternalActivity({
      running: false,
      scope,
      phase: 'done',
      done: 0,
      total: 0,
      currentTitle: null,
      summary: EMPTY_SUMMARY,
      error: null,
    });
    return 0;
  }

  // Sin await: el trabajo sigue por su cuenta y el invoke contesta ya. El
  // catch de dentro se encarga de todo error — aquí no queda ninguna promesa
  // rechazada suelta.
  void runPass(scope, games);
  return games.length;
};

const runPass = async (scope: RefreshScope, initialGames: TargetGame[]): Promise<void> => {
  let games = initialGames;
  let steamTargets = games.filter((game) => game.steamAppId !== null);
  // Lo que la red averiguó del appid, por juego. Sin entrada = no se preguntó.
  const appIds = new Map<GameId, AppIdResolution>();
  const appIdOf = (game: TargetGame): number | null => {
    const resolved = appIds.get(game.gameId);
    return resolved && resolved.kind !== 'not-on-steam' ? resolved.appId : game.steamAppId;
  };
  let summary: ExternalRefreshSummary = { ...EMPTY_SUMMARY, total: games.length };
  let error: string | null = null;

  const emit = (
    phase: 'igdb' | 'steam' | 'saving',
    done: number,
    currentTitle: string | null,
  ): void =>
    notifyExternalActivity({
      running: true,
      scope,
      phase,
      done,
      total: steamTargets.length,
      currentTitle,
      summary: null,
      error: null,
    });

  try {
    emit('igdb', 0, null);
    // Adopción de IGDB y SteamGridDB antes de la foto definitiva: un juego
    // que acaba de ganar igdbId entra ya en el lote de notas.
    const adoptedCount = await adoptIgdbForCandidates(findAdoptionCandidates());
    if (adoptedCount > 0) {
      games = selectTargets(scope);
      steamTargets = games.filter((game) => game.steamAppId !== null);
    }
    await fillMissingSgdbIds(scope);

    const inIgdb = games.filter(
      (game): game is TargetGame & { igdbId: number } => game.igdbId !== null,
    );
    const igdbByIgdbId = await getGameExternalBatch(inIgdb.map((game) => game.igdbId));

    // Appids que faltan (nunca los elegidos a mano).
    const withoutAppId = games.filter(needsAppIdLookup);
    for (let start = 0; start < withoutAppId.length; start += APPID_BATCH_SIZE) {
      const batch = withoutAppId.slice(start, start + APPID_BATCH_SIZE);
      const appIdByIgdbId = await getSteamAppIds(batch.map((game) => game.igdbId));
      for (const game of batch) {
        const appId = appIdByIgdbId.get(game.igdbId);
        appIds.set(
          game.gameId,
          appId === undefined ? { kind: 'not-on-steam' } : { kind: 'found', appId },
        );
      }
    }
    // Appids automáticos que apuntan al producto equivocado (playtest, demo…).
    const withAppId = games.filter(needsAppIdReview);
    for (let start = 0; start < withAppId.length; start += APPID_BATCH_SIZE) {
      const batch = withAppId.slice(start, start + APPID_BATCH_SIZE);
      const replacements = await findSteamAppIdFixes(batch);
      for (const game of batch) {
        const better = replacements.get(game.igdbId);
        if (better !== undefined) appIds.set(game.gameId, { kind: 'corrected', appId: better });
      }
    }
    const found = [...appIds.values()].filter((value) => value.kind === 'found').length;
    steamTargets = games.filter((game) => appIdOf(game) !== null);
    if (found > 0) console.log(`[steam] el refresco externo encontro ${found} appids nuevos`);

    const tagsByAppId = await getSteamTags(steamTargets.map((game) => appIdOf(game) as number));
    const steamByGameId = new Map<GameId, SteamGamePatch | null>();
    for (const [index, game] of steamTargets.entries()) {
      if (index > 0) await sleep(STEAM_REVIEWS_DELAY_MS);
      emit('steam', index, game.title);
      const appId = appIdOf(game) as number;
      steamByGameId.set(
        game.gameId,
        mergeSteamPatch(tagsByAppId.get(appId) ?? null, await getSteamReviewCounts(appId)),
      );
    }

    // Repesca de HLTB: solo los huérfanos de la foto de esta pasada.
    const orphans = selectHltbOrphans(
      appCtx(),
      scope,
      games.map((game) => game.gameId),
    );
    const hltbByGameId = new Map<GameId, HltbTimesData | null | SourceFailure>();
    let hltbChecked = 0;
    let hltbFound = 0;
    let hltbFailureStreak = 0;
    for (const [index, orphan] of orphans.entries()) {
      if (index > 0) await sleep(HLTB_ORPHANS_DELAY_MS);
      notifyExternalActivity({
        running: true,
        scope,
        phase: 'hltb',
        done: index,
        total: orphans.length,
        currentTitle: orphan.title,
        summary: null,
        error: null,
      });
      hltbChecked++;
      try {
        const fresh = orphan.igdbId === null ? undefined : igdbByIgdbId.get(orphan.igdbId);
        const times = await getHltbTimes(orphan.title, fresh?.releaseYear ?? orphan.releaseYear);
        hltbFailureStreak = 0;
        hltbByGameId.set(orphan.gameId, times ?? null);
        if (times) hltbFound++;
      } catch (caught) {
        hltbFailureStreak++;
        hltbByGameId.set(orphan.gameId, failed(caught));
        console.warn(`[hltb] la repesca no pudo con "${orphan.title}" (sigo):`, caught);
        if (hltbFailureStreak >= HLTB_ORPHANS_ABORT_AFTER) {
          console.warn(
            `[hltb] ${HLTB_ORPHANS_ABORT_AFTER} fallos seguidos - HLTB parece caido, la repesca se rinde con ${orphans.length - index - 1} huerfanos sin mirar`,
          );
          break;
        }
      }
    }

    emit('saving', steamTargets.length, null);
    let withRatings = 0;
    let withSummary = 0;
    let withFullDate = 0;
    let steamFound = 0;
    const items: RefreshPassItem[] = games.map((game) => {
      const igdb = game.igdbId === null ? null : (igdbByIgdbId.get(game.igdbId) ?? null);
      if (igdb) {
        if (igdb.ratingCritics !== null || igdb.ratingUsers !== null) withRatings++;
        if (igdb.summary !== null) withSummary++;
        if (igdb.releaseDate !== null) withFullDate++;
      }
      const steam = steamByGameId.get(game.gameId);
      if (steam) steamFound++;
      const appId = appIds.get(game.gameId);
      return {
        target: game,
        igdb,
        ...(appId ? { appId } : {}),
        ...(steamByGameId.has(game.gameId) ? { steam: steam ?? null } : {}),
        ...(hltbByGameId.has(game.gameId) ? { hltb: hltbByGameId.get(game.gameId) ?? null } : {}),
      };
    });
    // Una sola transacción, con relectura juego a juego (la red ya pasó).
    const applied = applyRefreshPass(appCtx(), items);

    for (const gameId of applied.correctedGameIds) {
      await queueAchievementsRefreshForGame(gameId, { notify: false }).catch((error: unknown) => {
        console.warn(`[steam] no se pudieron re-encolar los logros del juego ${gameId}:`, error);
        return false;
      });
    }

    summary = {
      total: games.length,
      updated: igdbByIgdbId.size,
      withRatings,
      withSummary,
      withFullDate,
      adoptedFromSteam: adoptedCount,
      appIdsFound: found,
      appIdsFixed: applied.correctedGameIds.length,
      steamChecked: steamTargets.length,
      steamFound,
      hltbChecked,
      hltbFound,
    };
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    console.error('[external] la pasada de datos externos fallo:', caught);
  } finally {
    running = false;
    notifyExternalActivity({
      running: false,
      scope,
      phase: 'done',
      done: steamTargets.length,
      total: steamTargets.length,
      currentTitle: null,
      summary: error === null ? summary : null,
      error,
    });
  }
};
