import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getGameExternalBatch } from '../igdb/api';
import type { ExternalRefreshSummary } from '../igdb/types';
import { getSteamSpyData, STEAMSPY_DELAY_MS } from '../steamspy/api';
import { notifyExternalActivity } from './notify';

// Datos externos de la biblioteca (PLAN-TO-PLAY.md §5): UN solo mecanismo con
// DOS puertas — el botón de la cabecera del Plan (solo los planeados, la
// puerta del día a día) y el de Ajustes (biblioteca entera, mantenimiento).
// Los dos llaman aquí; lo único que cambia es a qué juegos alcanza.
//
// Qué se refresca y qué NO:
//  · IGDB, 1-2 peticiones por lotes: notas, sinopsis, sagas y la fecha
//    completa con su precisión. Todo del mismo viaje.
//  · SteamSpy, en serie y solo para juegos con appid: etiquetas + reseñas.
//  · HowLongToBeat queda FUERA a propósito (§5.2): sin API de lotes, con
//    matching difuso y una API no oficial, 300 juegos serían una ráfaga
//    frágil de fallos mudos. Su botón por-juego de la ficha es la vía buena.
//
// ── Por qué el estado de la pasada vive AQUÍ y no en el componente ──────────
//
// La pasada de SteamSpy va a ~1 petición por segundo: con la biblioteca
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type RefreshScope = 'plan' | 'all';

type TargetGame = { id: number; igdbId: number; title: string; steamAppId: number | null };

const EMPTY_SUMMARY: ExternalRefreshSummary = {
  total: 0,
  updated: 0,
  withRatings: 0,
  withSummary: 0,
  withFullDate: 0,
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
// minutos de SteamSpy y ningún invoke debe quedarse colgado tanto rato (misma
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

const runPass = async (scope: RefreshScope, games: TargetGame[]): Promise<void> => {
  const steamTargets = games.filter((game) => game.steamAppId !== null);
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
      // El total del progreso es el de SteamSpy, que es la parte que de
      // verdad se ve avanzar: IGDB entero son 1-2 peticiones que terminan
      // antes de que dé tiempo a leer la primera cifra.
      total: steamTargets.length,
      currentTitle,
      summary: null,
      error: null,
    });

  try {
    emit('igdb', 0, null);

    // ── Red, fuera del candado ──────────────────────────────────────────────
    const igdbByIgdbId = await getGameExternalBatch(games.map((game) => game.igdbId));

    // SteamSpy va en SERIE con su pausa: es un servicio gratuito que pide ~1
    // req/s y no tiene endpoint de lotes. Que tarde minutos con la biblioteca
    // entera es correcto — se pide una vez en la vida y se guarda.
    const steamByGameId = new Map<number, Awaited<ReturnType<typeof getSteamSpyData>>>();
    for (const [index, game] of steamTargets.entries()) {
      if (index > 0) await sleep(STEAMSPY_DELAY_MS);
      emit('steam', index, game.title);
      steamByGameId.set(game.id, await getSteamSpyData(game.steamAppId as number));
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
          const igdb = igdbByIgdbId.get(game.igdbId);
          const steam = steamByGameId.get(game.id);
          if (steam) steamFound++;

          if (!igdb) {
            // IGDB no devolvió el juego: ya no está en su catálogo (rarísimo,
            // pero pasa). Se estampa el "preguntado" sin pisar nada de lo que
            // hubiera; si SteamSpy sí supo algo, eso sí se guarda.
            await tx
              .update(gamesTable)
              .set({
                ratingsCheckedAt: now,
                ...(game.steamAppId !== null ? { steamSpyCheckedAt: now } : {}),
                ...(steam ?? {}),
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
              ...(game.steamAppId !== null ? { steamSpyCheckedAt: now } : {}),
              ...(steam ?? {}),
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
