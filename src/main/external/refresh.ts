import { and, eq, isNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getHltbTimes } from '../hltb/api';
import type { HltbTimes } from '../hltb/types';
import { getGameExternalBatch, getSteamAppIds } from '../igdb/api';
import type { ExternalRefreshSummary } from '../igdb/types';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { getSteamReviewCounts, STEAM_REVIEWS_DELAY_MS } from '../steam/reviews';
import { getSteamTags } from '../steam/tags';
import { adoptIgdbForCandidates, findAdoptionCandidates } from './adoptIgdb';
import { buildIgdbBatchPatch } from './igdbPatch';
import { fillMissingSgdbIds } from './sgdbBackfill';
import { notifyExternalActivity } from './notify';
import { findSteamAppIdFixes } from './steamAppIdFix';
import { mergeSteamPatch, type SteamGamePatch } from './steamData';

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
type TargetGame = {
  id: number;
  igdbId: number | null;
  title: string;
  steamAppId: number | null;
  steamAppIdManual: boolean;
};

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

const selectTargets = async (scope: RefreshScope): Promise<TargetGame[]> =>
  withDbAccess(async () => {
    const query = getDb()
      .select({
        id: gamesTable.id,
        igdbId: gamesTable.igdbId,
        title: gamesTable.title,
        steamAppId: gamesTable.steamAppId,
        steamAppIdManual: gamesTable.steamAppIdManual,
      })
      .from(gamesTable);
    return scope === 'plan' ? query.where(eq(gamesTable.planned, true)) : query;
  });

// Los huérfanos de HowLongToBeat: ni main, ni extras, ni completionist. Los
// TRES a null y no "alguno": un juego con parte de los tiempos es un juego
// que HLTB ya reconoció (hay fichas con un solo tramo enviado), y re-pedirlo
// es justo el refresco masivo que la cabecera descarta. Query aparte de
// selectTargets a propósito: se lee justo antes de la repesca, con el estado
// más fresco, y solo las filas que tocan.
type HltbOrphan = { id: number; igdbId: number | null; title: string; releaseYear: number | null };

const selectHltbOrphans = async (scope: RefreshScope): Promise<HltbOrphan[]> =>
  withDbAccess(async () => {
    const missing = and(
      isNull(gamesTable.hltbMain),
      isNull(gamesTable.hltbMainExtras),
      isNull(gamesTable.hltbCompletionist),
    );
    return getDb()
      .select({
        id: gamesTable.id,
        igdbId: gamesTable.igdbId,
        title: gamesTable.title,
        releaseYear: gamesTable.releaseYear,
      })
      .from(gamesTable)
      .where(scope === 'plan' ? and(eq(gamesTable.planned, true), missing) : missing);
  });

// Arranca la pasada y devuelve ENSEGUIDA, con cuántos juegos entran en ella.
// El progreso viaja por 'external:activity': una biblioteca entera son
// minutos de reseñas y ningún invoke debe quedarse colgado tanto rato (misma
// decisión que el backfill de curiosidades y la redescarga de imágenes).
//
// 0 = no arrancó nada, y no dice por qué: puede ser "ya había una pasada en
// marcha" o "no hay ni un juego que refrescar". Quien necesite distinguirlo
// pregunta antes por isExternalRefreshRunning() — lo hace el radar en
// radar/pass.ts, y la tarjeta de Ajustes lo lee por 'external:status'.
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
    games = await selectTargets(scope);
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
  // Arranca con los que YA tienen appid y crece si la ronda de appids
  // encuentra alguno más. Declarado con `let` y con valor desde el principio
  // a propósito: el `finally` lo lee para el evento final, y si la pasada
  // reventara antes de la ronda de appids, un `const` calculado más abajo lo
  // dejaría sin definir justo en el camino del error.
  let steamTargets = games.filter((game) => game.steamAppId !== null);
  // gameId -> appid recién resuelto. Se guarda en memoria y se escribe en la
  // transacción del final, como todo lo demás: si IGDB o Steam fallan a
  // mitad, no se ha tocado ni una fila.
  const foundAppIds = new Map<number, number>();
  // De esos, cuales son CORRECCIONES de un appid que ya existia (apuntaba al
  // playtest o a otro producto) y no estrenos. foundAppIds los lleva juntos
  // porque la fontaneria de la pasada es identica para los dos; el parte
  // final NO puede mezclarlos -- ver appIdsFixed en ExternalRefreshSummary.
  const correctedGameIds = new Set<number>();
  // EL appid de un juego a estas alturas de la pasada: el que ya tenía o el
  // que acaba de aparecer. Un solo sitio que lo decida, porque lo preguntan
  // tres: a quién se le pide a Steam, con qué appid, y a quién se le estampa
  // el steamSpyCheckedAt al guardar.
  // foundAppIds PRIMERO, no el guardado: además de los que estaban a null,
  // ahora lleva las CORRECCIONES de los que apuntaban donde no debian. Al reves
  // (como estaba) se le pedirian las etiquetas del juego equivocado, que es
  // exactamente lo que se viene a arreglar.
  const appIdOf = (game: TargetGame): number | null =>
    foundAppIds.get(game.id) ?? game.steamAppId ?? null;
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
      // El total del progreso es el de las reseñas, que es la parte que de
      // verdad se ve avanzar: IGDB entero son 1-2 peticiones que terminan
      // antes de que dé tiempo a leer la primera cifra.
      total: steamTargets.length,
      currentTitle,
      summary: null,
      error: null,
    });

  try {
    emit('igdb', 0, null);

    // ── ¿Alguno ya está en IGDB? ────────────────────────────────────────────
    // Lo PRIMERO de la pasada, y a propósito: los juegos dados de alta solo
    // con Steam (porque IGDB no los tenía) cambian aquí de fuente, y así el
    // resto de la pasada ya los trata como juegos de IGDB normales — entran
    // en el lote de notas, en el de appids y en todo lo demás.
    const adoptedCount = await adoptIgdbForCandidates(await findAdoptionCandidates());
    // Se relee la lista si hubo adopciones: los que acaban de ganar igdbId
    // tienen que entrar en el lote de IGDB de aquí abajo, no esperar a la
    // pasada siguiente.
    if (adoptedCount > 0) {
      games = await selectTargets(scope);
      // Y con ella la lista de Steam: la adopción no cambia qué juegos tienen
      // appid, pero sí sus TÍTULOS (pasan a los de IGDB), y esos títulos son
      // los que el progreso va cantando juego a juego.
      steamTargets = games.filter((game) => game.steamAppId !== null);
    }

    // Y el id de SteamGridDB de los que no lo tengan — mismo motivo que la
    // adopción de arriba: un juego dado de alta recién anunciado no tenía arte
    // todavía, y ese "no" caduca (ver external/sgdbBackfill.ts). Con el
    // ALCANCE de esta pasada: recorría la biblioteca entera incluso pulsando el
    // botón del Plan, que promete tocar solo los planeados.
    await fillMissingSgdbIds(scope);

    // ── Red, fuera del candado ──────────────────────────────────────────────
    // Solo los que TIENEN id de IGDB: a los de Steam sin ficha en IGDB no hay
    // a quién preguntarles, y colar un null en la query los rompería a todos.
    const inIgdb = games.filter(
      (game): game is TargetGame & { igdbId: number } => game.igdbId !== null,
    );
    const igdbByIgdbId = await getGameExternalBatch(inIgdb.map((game) => game.igdbId));

    // Los appids que faltan, re-preguntados (ver el bloque de arriba). Va
    // dentro de la fase 'igdb' porque es lo mismo: peticiones de catálogo que
    // vuelan, sin nada que enseñar juego a juego.
    const withoutAppId = inIgdb.filter(
      (game) => game.steamAppId === null && !game.steamAppIdManual,
    );
    for (let start = 0; start < withoutAppId.length; start += APPID_BATCH_SIZE) {
      const batch = withoutAppId.slice(start, start + APPID_BATCH_SIZE);
      const appIdByIgdbId = await getSteamAppIds(batch.map((game) => game.igdbId));
      for (const game of batch) {
        const appId = appIdByIgdbId.get(game.igdbId);
        if (appId !== undefined) foundAppIds.set(game.id, appId);
      }
    }
    // Y los que TIENEN appid pero apunta donde no debe: al playtest del propio
    // juego, o directamente a otro producto (findSteamAppIdCorrections explica
    // los dos casos). Este botón es "ponlo todo al día", y un juego que enseña
    // las reseñas de OTRO juego es justo lo que hay que poner al día. No se
    // re-resuelve nada más: el guardado se comprueba contra las entradas de
    // Steam de su propia ficha.
    const withAppId = inIgdb.filter(
      (game): game is typeof game & { steamAppId: number } =>
        game.steamAppId !== null && !game.steamAppIdManual,
    );
    for (let start = 0; start < withAppId.length; start += APPID_BATCH_SIZE) {
      const batch = withAppId.slice(start, start + APPID_BATCH_SIZE);
      // El aviso por consola de cada corrección lo da el helper: es el mismo
      // en las tres rutas de refresco (ver external/steamAppIdFix.ts).
      const replacements = await findSteamAppIdFixes(batch);
      for (const game of batch) {
        const better = replacements.get(game.igdbId);
        if (better !== undefined) {
          foundAppIds.set(game.id, better);
          correctedGameIds.add(game.id);
        }
      }
    }

    // Los recién encontrados entran en la pasada de Steam DE ESTA MISMA
    // vuelta: sería absurdo descubrir el appid y hacer esperar sus etiquetas y
    // sus reseñas a que el usuario vuelva a pulsar el botón mañana.
    if (foundAppIds.size > 0) {
      steamTargets = games.filter((game) => game.steamAppId !== null || foundAppIds.has(game.id));
      // Solo los ESTRENOS: las correcciones ya cantaron una a una por consola
      // (el aviso vive en steamAppIdFix.ts) y tienen su propio contador.
      const discovered = foundAppIds.size - correctedGameIds.size;
      if (discovered > 0) {
        console.log(`[steam] el refresco externo encontro ${discovered} appids nuevos`);
      }
    }

    // Las ETIQUETAS de todos, de golpe: la API de la tienda acepta lotes (de
    // 50 en 50, ver steam/tags.ts), así que la biblioteca entera son un
    // puñado de peticiones y unos segundos.
    const tagsByAppId = await getSteamTags(steamTargets.map((game) => appIdOf(game) as number));

    // Las RESEÑAS sí van una a una con su pausa: el resumen es por juego y no
    // hay endpoint de lotes. Esta es la parte que de verdad se ve avanzar, y
    // la única que justifica la barra de progreso.
    const steamByGameId = new Map<number, SteamGamePatch | null>();
    for (const [index, game] of steamTargets.entries()) {
      if (index > 0) await sleep(STEAM_REVIEWS_DELAY_MS);
      emit('steam', index, game.title);
      const appId = appIdOf(game) as number;
      steamByGameId.set(
        game.id,
        mergeSteamPatch(tagsByAppId.get(appId) ?? null, await getSteamReviewCounts(appId)),
      );
    }

    // ── HowLongToBeat, solo los huérfanos ──────────────────────────────────
    // Después de las reseñas y antes de guardar (sus tiempos entran en la
    // misma transacción). La lista se lee AHORA y no al principio: así un
    // juego al que el botón de su ficha ya le encontró tiempos durante esta
    // misma pasada no se re-pregunta.
    //
    // Y RECORTADA a los juegos de ESTA pasada, que no es lo mismo: la lista de
    // huérfanos se lee ahora y `games` se leyó al principio, así que un juego
    // dado de alta mientras corrían las reseñas (minutos, con la biblioteca
    // entera) aparecía aquí y NO allí. Se le pedían los tiempos a HLTB —con su
    // petición y su segundo de pausa—, hltbChecked lo contaba y el parte de
    // Ajustes sumaba su hallazgo… y la transacción de abajo recorre `games`,
    // así que su fila no se escribía nunca: "N tiempos recuperados" con uno de
    // ellos todavía a null.
    const idsInThisPass = new Set(games.map((game) => game.id));
    const orphans = (await selectHltbOrphans(scope)).filter((orphan) =>
      idsInThisPass.has(orphan.id),
    );
    const hltbByGameId = new Map<number, HltbTimes>();
    let hltbChecked = 0;
    let hltbFailureStreak = 0;
    for (const [index, orphan] of orphans.entries()) {
      if (index > 0) await sleep(HLTB_ORPHANS_DELAY_MS);
      notifyExternalActivity({
        running: true,
        scope,
        phase: 'hltb',
        done: index,
        // Total PROPIO (los huérfanos), no el de las reseñas: es otra cola y
        // la barra tiene que contar lo que de verdad queda.
        total: orphans.length,
        currentTitle: orphan.title,
        summary: null,
        error: null,
      });
      hltbChecked++;
      try {
        // El año fresco de IGDB si esta pasada lo trajo, que para el match
        // vale más que el guardado (los años bailan alrededor del anuncio).
        const fresh = orphan.igdbId === null ? undefined : igdbByIgdbId.get(orphan.igdbId);
        const times = await getHltbTimes(orphan.title, fresh?.releaseYear ?? orphan.releaseYear);
        hltbFailureStreak = 0;
        // null = HLTB sigue sin conocerlo (o sin tiempos enviados): se queda
        // huérfano y la próxima pasada volverá a intentarlo. No es un fallo.
        if (times) hltbByGameId.set(orphan.id, times);
      } catch (caught) {
        hltbFailureStreak++;
        console.warn(`[hltb] la repesca no pudo con "${orphan.title}" (sigo):`, caught);
        if (hltbFailureStreak >= HLTB_ORPHANS_ABORT_AFTER) {
          // Nada de caps silenciosos: se dice cuántos se quedan sin mirar.
          console.warn(
            `[hltb] ${HLTB_ORPHANS_ABORT_AFTER} fallos seguidos - HLTB parece caido, la repesca se rinde con ${orphans.length - index - 1} huerfanos sin mirar`,
          );
          break;
        }
      }
    }

    emit('saving', steamTargets.length, null);

    // ── Escritura, transaccional ────────────────────────────────────────────
    const now = new Date();
    let withRatings = 0;
    let withSummary = 0;
    let withFullDate = 0;
    let steamFound = 0;

    await withDbAccess(async () =>
      getDb().transaction(async (tx) => {
        for (const game of games) {
          // Sin id de IGDB no hay nada que buscar: se trata igual que un juego
          // que IGDB ya no lista — se conserva lo que hubiera y se sigue con
          // lo de Steam, que es independiente.
          const igdb = game.igdbId === null ? undefined : igdbByIgdbId.get(game.igdbId);
          const steam = steamByGameId.get(game.id);
          if (steam) steamFound++;

          // Todo lo de Steam de este juego, igual tanto si IGDB contestó como
          // si no. El appid recién resuelto se guarda AQUÍ, en la misma
          // transacción que el resto. foundAppIds lleva dos cosas: los que
          // estaban a null y los que apuntaban a otro juego y se corrigen —
          // ningún appid bueno entra ahí, así que esto no puede pisar uno.
          //
          // Y esas dos cosas no se escriben igual. Un appid CORREGIDO cambia
          // de producto: las etiquetas y las reseñas guardadas son las del
          // juego viejo, no un dato de este que haya envejecido. Por eso van a
          // null ANTES de esparcir lo que Steam haya contestado —el orden de
          // estas líneas ES la regla—: lo que traiga las pisa, y lo que no se
          // queda vacío. El caso real es el remake sin salir ("Trails in the
          // Sky 2nd Chapter" llevaba el appid del original de 2015): su página
          // existe, así que hay etiquetas, pero aún no tiene ni una reseña — y
          // sin esto la ficha seguiría enseñando los tres mil votos del juego
          // de 2015 colgados ya del appid bueno. La regla de la casa ("un no
          // externo no borra lo que había") protege un dato de este juego, y
          // esos números nunca lo fueron.
          const foundAppId = foundAppIds.get(game.id);
          const corrected = foundAppId !== undefined && game.steamAppId !== null;
          const steamFields = {
            ...(foundAppId !== undefined
              ? { steamAppId: foundAppId, steamAppIdCheckedAt: now }
              : {}),
            ...(appIdOf(game) !== null ? { steamSpyCheckedAt: now } : {}),
            ...(corrected ? { steamTags: null, steamPositive: null, steamNegative: null } : {}),
            ...(steam ?? {}),
          };
          const sameSteamIdentity = and(
            eq(gamesTable.id, game.id),
            eq(gamesTable.steamAppIdManual, game.steamAppIdManual),
            game.steamAppId === null
              ? isNull(gamesTable.steamAppId)
              : eq(gamesTable.steamAppId, game.steamAppId),
          );

          if (!igdb) {
            // IGDB no devolvió el juego: ya no está en su catálogo (rarísimo,
            // pero pasa). Se estampa el "preguntado" sin pisar nada de lo que
            // hubiera; si Steam sí supo algo, eso sí se guarda.
            await tx
              .update(gamesTable)
              .set({
                ratingsCheckedAt: now,
                ...steamFields,
                // Los tiempos repescados, si este es uno de los huérfanos.
                // Solo hay entrada cuando HLTB contestó CON tiempos, así que
                // esto nunca pisa nada: el juego tenía los tres a null.
                ...(hltbByGameId.get(game.id) ?? {}),
              })
              .where(sameSteamIdentity);
            continue;
          }

          if (igdb.ratingCritics !== null || igdb.ratingUsers !== null) withRatings++;
          if (igdb.summary !== null) withSummary++;
          if (igdb.releaseDate !== null) withFullDate++;

          await tx
            .update(gamesTable)
            .set({
              // Las columnas del lote de IGDB, con el radar semanal: las dos
              // pasadas escriben lo MISMO y lo tenían copiado a mano (ver
              // external/igdbPatch.ts, incluido lo de releaseYear y el null).
              ...buildIgdbBatchPatch(igdb, now),
              ...steamFields,
              // Los tiempos repescados de los huérfanos — ver la otra rama.
              ...(hltbByGameId.get(game.id) ?? {}),
            })
            .where(sameSteamIdentity);
        }
      }),
    );

    // ── Y LOS LOGROS DE LOS APPIDS CORREGIDOS ──────────────────────────────
    //
    // Después de la transacción a propósito: la cola relee el appid de la base
    // de datos, no de aquí (mismo orden que el botón de la ficha, ver el paso
    // 5 de external/refreshGame.ts).
    //
    // Corregir el appid y no re-preguntar los logros era dejar la corrección a
    // medias, y para siempre: el catálogo y los desbloqueos guardados son los
    // del producto viejo, y la pasada de logros del arranque solo recoge a los
    // que tienen `achievementsSyncedAt` a null (steam/backfill.ts), así que un
    // juego ya sincronizado con el appid equivocado —el remake que llevaba el
    // appid del original de 2015— no volvía a entrar jamás salvo pulsando
    // "Sync now" a mano. Las etiquetas y las reseñas ya se re-piden aquí
    // arriba; esto es la tercera cosa que cuelga del appid.
    //
    // notify: false porque esto es una pasada masiva y los avisos flotantes
    // son para lo que ACABA de pasar, no para logros de hace años (mismo
    // criterio que el alta y que el resto de barridos).
    for (const gameId of correctedGameIds) {
      // Con su propio catch: la transacción ya escribió todo, y un tropiezo
      // encolando no puede convertir la pasada entera en "no se pudo".
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
      appIdsFound: foundAppIds.size - correctedGameIds.size,
      appIdsFixed: correctedGameIds.size,
      steamChecked: steamTargets.length,
      steamFound,
      hltbChecked,
      hltbFound: hltbByGameId.size,
    };
  } catch (caught) {
    // El invoke ya contestó, así que un error aquí no tiene promesa por la que
    // subir: viaja en el evento final. Sin esto, un fallo de IGDB dejaba la
    // tarjeta girando para siempre.
    error = caught instanceof Error ? caught.message : String(caught);
    console.error('[external] la pasada de datos externos fallo:', caught);
  } finally {
    // SIEMPRE: libera el candado y avisa de que terminó (aunque terminara
    // mal), para que ninguna pantalla se quede pintando "Refreshing…".
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
