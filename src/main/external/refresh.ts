import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getGameExternalBatch, getSteamAppIds } from '../igdb/api';
import type { ExternalRefreshSummary } from '../igdb/types';
import { getSteamReviewCounts, STEAM_REVIEWS_DELAY_MS } from '../steam/reviews';
import { getSteamTags } from '../steam/tags';
import { adoptIgdbForCandidates, findAdoptionCandidates } from './adoptIgdb';
import { fillMissingSgdbIds } from './sgdbBackfill';
import { notifyExternalActivity } from './notify';
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
//  · HowLongToBeat queda FUERA a propósito (§5.2): sin API de lotes, con
//    matching difuso y una API no oficial, 300 juegos serían una ráfaga
//    frágil de fallos mudos. Su botón por-juego de la ficha es la vía buena.
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
// detrás de la pasada de reseñas, que dura minutos. Los que YA tienen appid
// ni se tocan: eso es identidad del juego y no se re-resuelve por gusto.

// Mismo tamaño que el backfill de arranque y por el mismo motivo (ver
// appIdBackfill.ts): un juego puede tener VARIAS entradas de Steam, así que
// las filas devueltas superan a los juegos pedidos y hace falta margen para
// no tocar el límite de 500 de IGDB.
const APPID_BATCH_SIZE = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type RefreshScope = 'plan' | 'all';

// igdbId null = juego que no está en el catálogo de IGDB (existe en Steam y
// ellos todavía no lo tienen). Entra igual en la pasada: lo de Steam sí se le
// puede pedir, solo se salta la parte de IGDB.
type TargetGame = { id: number; igdbId: number | null; title: string; steamAppId: number | null };

const EMPTY_SUMMARY: ExternalRefreshSummary = {
  total: 0,
  updated: 0,
  withRatings: 0,
  withSummary: 0,
  withFullDate: 0,
  adoptedFromSteam: 0,
  appIdsFound: 0,
  steamChecked: 0,
  steamFound: 0,
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
      })
      .from(gamesTable);
    return scope === 'plan' ? query.where(eq(gamesTable.planned, true)) : query;
  });

// Arranca la pasada y devuelve ENSEGUIDA, con cuántos juegos entran en ella.
// El progreso viaja por 'external:activity': una biblioteca entera son
// minutos de reseñas y ningún invoke debe quedarse colgado tanto rato (misma
// decisión que el backfill de curiosidades y la redescarga de imágenes).
export const startExternalRefresh = async (scope: RefreshScope): Promise<number> => {
  // Dos pasadas a la vez se pisarían las mismas filas y doblarían las
  // peticiones a un servicio gratuito que pide ir despacio.
  if (running) return 0;

  const games = await selectTargets(scope);
  if (games.length === 0) {
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

  running = true;
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
  // EL appid de un juego a estas alturas de la pasada: el que ya tenía o el
  // que acaba de aparecer. Un solo sitio que lo decida, porque lo preguntan
  // tres: a quién se le pide a Steam, con qué appid, y a quién se le estampa
  // el steamSpyCheckedAt al guardar.
  const appIdOf = (game: TargetGame): number | null =>
    game.steamAppId ?? foundAppIds.get(game.id) ?? null;
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
    // todavía, y ese "no" caduca (ver external/sgdbBackfill.ts).
    await fillMissingSgdbIds();

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
    const withoutAppId = inIgdb.filter((game) => game.steamAppId === null);
    for (let start = 0; start < withoutAppId.length; start += APPID_BATCH_SIZE) {
      const batch = withoutAppId.slice(start, start + APPID_BATCH_SIZE);
      const appIdByIgdbId = await getSteamAppIds(batch.map((game) => game.igdbId));
      for (const game of batch) {
        const appId = appIdByIgdbId.get(game.igdbId);
        if (appId !== undefined) foundAppIds.set(game.id, appId);
      }
    }
    // Los recién encontrados entran en la pasada de Steam DE ESTA MISMA
    // vuelta: sería absurdo descubrir el appid y hacer esperar sus etiquetas y
    // sus reseñas a que el usuario vuelva a pulsar el botón mañana.
    if (foundAppIds.size > 0) {
      steamTargets = games.filter((game) => game.steamAppId !== null || foundAppIds.has(game.id));
      console.log(`[steam] el refresco externo encontro ${foundAppIds.size} appids nuevos`);
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
          // transacción que el resto: foundAppIds solo lleva los que estaban a
          // null, así que esto no puede pisar un appid bueno.
          const foundAppId = foundAppIds.get(game.id);
          const steamFields = {
            ...(foundAppId !== undefined
              ? { steamAppId: foundAppId, steamAppIdCheckedAt: now }
              : {}),
            ...(appIdOf(game) !== null ? { steamSpyCheckedAt: now } : {}),
            ...(steam ?? {}),
          };

          if (!igdb) {
            // IGDB no devolvió el juego: ya no está en su catálogo (rarísimo,
            // pero pasa). Se estampa el "preguntado" sin pisar nada de lo que
            // hubiera; si Steam sí supo algo, eso sí se guarda.
            await tx
              .update(gamesTable)
              .set({
                ratingsCheckedAt: now,
                ...steamFields,
              })
              .where(eq(gamesTable.id, game.id));
            continue;
          }

          if (igdb.ratingCritics !== null || igdb.ratingUsers !== null) withRatings++;
          if (igdb.summary !== null) withSummary++;
          if (igdb.releaseDate !== null) withFullDate++;

          await tx
            .update(gamesTable)
            .set({
              ratingCritics: igdb.ratingCritics,
              ratingCriticsCount: igdb.ratingCriticsCount,
              ratingUsers: igdb.ratingUsers,
              ratingUsersCount: igdb.ratingUsersCount,
              summary: igdb.summary,
              igdbCollections: igdb.igdbCollections,
              releaseDate: igdb.releaseDate,
              releaseDatePrecision: igdb.releaseDatePrecision,
              // releaseYear se refresca también, pero NUNCA se pone a null: de
              // él dependen las stats (el donut de edad) y el matching de
              // HowLongToBeat, así que un juego al que IGDB haya dejado de
              // ponerle fecha no puede perder el año que ya tenía.
              ...(igdb.releaseYear !== null ? { releaseYear: igdb.releaseYear } : {}),
              ratingsCheckedAt: now,
              ...steamFields,
            })
            .where(eq(gamesTable.id, game.id));
        }
      }),
    );

    summary = {
      total: games.length,
      updated: igdbByIgdbId.size,
      withRatings,
      withSummary,
      withFullDate,
      adoptedFromSteam: adoptedCount,
      appIdsFound: foundAppIds.size,
      steamChecked: steamTargets.length,
      steamFound,
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
