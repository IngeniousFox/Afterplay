import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { diceCoefficient, findBestTitleMatch, normalizeTitle } from '../lib/titleMatch';
import { getRaConsoles, getRaGameList, hasRaCredentials } from './api';
import type { RaGameListEntry } from './api';
import { raConsoleIdsForPlatforms } from './consoles';
import { readRaState, writeRaState } from './state';
import { syncRaGame } from './sync';

// El emparejado y las pasadas de RetroAchievements (RETROACHIEVEMENTS.md
// §5-6). La regla de oro que gobierna todo el archivo: ningún "no" de RA se
// graba en piedra — raCheckedAt fecha cada intento, y el barrido periódico
// re-pregunta porque los sets se publican cada semana y las consolas nuevas
// cada año.

// Cada cuánto se re-intenta el emparejado de los que siguen sin set. Los
// sets nuevos salen semanalmente; preguntar cada pocos días llega de sobra
// y son ~1 petición por consola con juegos pendientes.
const REMATCH_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

// Umbral PROPIO por encima del genérico de findBestTitleMatch (0.5): las
// listas de RA no traen año, así que no hay desempate — sin él, un 0.6 de
// parecido es una apuesta, no un match. Preferimos dejar el juego sin
// emparejar (el barrido reintentará, y el fallo es visible) a colgarle el
// set de otro juego (fallo silencioso con logros de otro).
const MIN_RA_SIMILARITY = 0.8;

// Respiro entre juegos al sincronizar en cadena. Aquí NO vale el ritmo de la
// cola de Steam (120ms — su API aguanta 100k/día): la de RA va detrás de
// Cloudflare con un límite por minuto corto, y con 150ms devolvió un 429
// real al 14º juego seguido de la primera pasada. A ~1.2s por juego la
// pasada entera de una biblioteca retro sigue siendo un minuto largo, y el
// 429 queda además cubierto por el reintento con backoff de raRequest — este
// respiro es para no PROVOCARLO, aquel para sobrevivirlo.
const BREATHE_MS = 1200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type MatchCandidate = {
  id: number;
  title: string;
  releaseYear: number | null;
  officialPlatforms: string[] | null;
  heroUrl: string | null;
};

// Emparejar UN juego contra las listas (ya bajadas) de sus consolas.
const matchAgainstLists = (
  game: MatchCandidate,
  lists: Map<number, RaGameListEntry[]>,
  consoleIds: number[],
): number | null => {
  const candidates = consoleIds.flatMap((consoleId) => lists.get(consoleId) ?? []);
  if (candidates.length === 0) return null;

  const best = findBestTitleMatch(
    candidates,
    (candidate) => candidate.title,
    () => undefined,
    game.title,
    game.releaseYear,
  );
  if (!best) return null;

  const similarity = diceCoefficient(normalizeTitle(best.title), normalizeTitle(game.title));
  return similarity >= MIN_RA_SIMILARITY ? best.raGameId : null;
};

// Un único hilo de sincronización RA a la vez. Las dos pasadas que encadenan
// syncRaGame con BREATHE_MS de respiro —el nivel 3 del arranque y el "Sync
// now" de Ajustes— comparten este candado: dos corriendo a la vez partirían
// el respiro por la mitad y provocarían justo el 429 que BREATHE_MS existe
// para evitar, además de sincronizar el mismo juego dos veces en paralelo.
let raSyncChainRunning = false;

// El bucle común de las dos: sincroniza en cadena, un fallo de uno no corta
// los demás, y respira entre cada uno. Antes estaba copiado en los dos sitios.
// El tipo es justo lo que pide syncRaGame — no MatchCandidate, que trae
// releaseYear/officialPlatforms que aquí ya no hacen falta (el emparejado ya
// pasó).
type SyncableRaGame = { id: number; title: string; raGameId: number; heroUrl: string | null };

const runRaSyncChain = async (games: SyncableRaGame[]): Promise<void> => {
  for (const game of games) {
    try {
      await syncRaGame(game, false);
    } catch (error) {
      console.warn(`[ra] fallo sincronizando "${game.title}":`, error);
    }
    await sleep(BREATHE_MS);
  }
};

// La pasada de arranque (encadenada tras el primer sync en main/index.ts):
//
//   1. Detectar consolas NUEVAS en RA (nivel 1 de §6): si aparece una, los
//      juegos de esa plataforma vuelven a ser candidatos aunque su
//      raCheckedAt fuera reciente.
//   2. Emparejar los candidatos (sin raGameId y sin preguntar hace poco),
//      bajando UNA lista por consola implicada.
//   3. Sincronizar los emparejados que aún no tienen catálogo.
export const runRaStartupPass = async (): Promise<void> => {
  if (!hasRaCredentials()) return;

  try {
    // ── Nivel 1: consolas nuevas ─────────────────────────────────────────
    const consoles = await getRaConsoles();
    const state = readRaState();
    const known = new Set(state.knownConsoleIds);
    const newConsoleIds = consoles.map((entry) => entry.id).filter((id) => !known.has(id));

    // Solo si YA había una foto anterior: en el primer arranque todo es
    // "nuevo" y los candidatos de abajo ya lo cubren sin tocar nada.
    if (newConsoleIds.length > 0 && state.knownConsoleIds.length > 0) {
      const newSet = new Set(newConsoleIds);
      const all = await withDbAccess(async () =>
        getDb()
          .select({ id: gamesTable.id, officialPlatforms: gamesTable.officialPlatforms })
          .from(gamesTable)
          .where(isNull(gamesTable.raGameId)),
      );
      const toReset = all
        .filter((game) =>
          raConsoleIdsForPlatforms(game.officialPlatforms).some((id) => newSet.has(id)),
        )
        .map((game) => game.id);
      if (toReset.length > 0) {
        await withDbAccess(async () =>
          getDb().transaction(async (tx) => {
            for (const id of toReset) {
              await tx.update(gamesTable).set({ raCheckedAt: null }).where(eq(gamesTable.id, id));
            }
          }),
        );
        // Solo ASCII en los console.log, convencion de la casa.
        console.log(
          `[ra] ${newConsoleIds.length} consola(s) nueva(s) en RA - ${toReset.length} juego(s) vuelven a ser candidatos`,
        );
      }
    }
    writeRaState({ knownConsoleIds: consoles.map((entry) => entry.id) });

    // ── Nivel 2: emparejar candidatos ────────────────────────────────────
    const cutoff = new Date(Date.now() - REMATCH_AFTER_MS);
    const candidates = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          releaseYear: gamesTable.releaseYear,
          officialPlatforms: gamesTable.officialPlatforms,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(
          and(
            isNull(gamesTable.raGameId),
            or(isNull(gamesTable.raCheckedAt), lt(gamesTable.raCheckedAt, cutoff)),
          ),
        ),
    );

    const withConsoles = candidates
      .map((game) => ({ game, consoleIds: raConsoleIdsForPlatforms(game.officialPlatforms) }))
      .filter((entry) => entry.consoleIds.length > 0);

    // OJO: sin candidatos NO se sale de la función — el nivel 3 de abajo
    // tiene que correr igual. El fallo real que enseñó esto: tras la primera
    // pasada todo queda emparejado o marcado, este bloque no tiene trabajo, y
    // un `return` aquí dejaba los catálogos fallidos por el 429 sin
    // reintentarse JAMÁS en los arranques siguientes.
    if (withConsoles.length > 0) {
      const neededConsoles = [...new Set(withConsoles.flatMap((entry) => entry.consoleIds))];
      const lists = new Map<number, RaGameListEntry[]>();
      for (const consoleId of neededConsoles) {
        try {
          lists.set(consoleId, await getRaGameList(consoleId));
        } catch (error) {
          console.warn(`[ra] no se pudo bajar la lista de la consola ${consoleId}:`, error);
        }
      }

      const checkedAt = new Date();
      const matched: (MatchCandidate & { raGameId: number })[] = [];
      await withDbAccess(async () =>
        getDb().transaction(async (tx) => {
          for (const { game, consoleIds } of withConsoles) {
            // Si su lista no se pudo bajar, no se marca como preguntado: que
            // el proximo arranque lo reintente.
            if (!consoleIds.some((id) => lists.has(id))) continue;
            const raGameId = matchAgainstLists(game, lists, consoleIds);
            await tx
              .update(gamesTable)
              .set({ raGameId, raCheckedAt: checkedAt })
              .where(eq(gamesTable.id, game.id));
            if (raGameId !== null) matched.push({ ...game, raGameId });
          }
        }),
      );
      if (matched.length > 0) {
        console.log(`[ra] emparejados ${matched.length}/${withConsoles.length} juego(s) con RA`);
      }
    }

    // ── Nivel 3: catálogo de los emparejados que no lo tienen ────────────
    // (los recién emparejados de arriba, más los que quedaran a medias de
    // una pasada anterior).
    const pendingSync = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          raGameId: gamesTable.raGameId,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(and(isNull(gamesTable.achievementsSyncedAt), isNull(gamesTable.steamAppId))),
    );
    const toSync = pendingSync.filter(
      (game): game is typeof game & { raGameId: number } => game.raGameId !== null,
    );
    // Si un "Sync now" ya está sincronizando en cadena, este nivel 3 sobra
    // (aquel cubre TODOS los emparejados, estos incluidos) y correrlo a la
    // vez es justo lo que el candado evita. Se salta sin más: no hay nada que
    // reintentar que el otro no vaya a tocar.
    if (toSync.length > 0 && !raSyncChainRunning) {
      raSyncChainRunning = true;
      try {
        await runRaSyncChain(toSync);
        console.log(`[ra] catalogos traidos para ${toSync.length} juego(s)`);
      } finally {
        raSyncChainRunning = false;
      }
    }
  } catch (error) {
    // RA caído o sin red: nada queda a medias (raCheckedAt solo se marca con
    // lista en mano) y el próximo arranque reintenta solo.
    console.warn('[ra] fallo en la pasada de arranque (se reintentara):', error);
  }
};

// El "Sync now" de Ajustes también refresca RA: TODOS los emparejados, de
// uno en uno. Devuelve cuántos entraron.
export const runRaFullResync = async (): Promise<number> => {
  if (!hasRaCredentials()) return 0;
  // Ya hay una cadena de sync en marcha (otro "Sync now", o el nivel 3 del
  // arranque): no arrancar una segunda o se solapan y disparan el 429.
  if (raSyncChainRunning) return 0;

  const games = await withDbAccess(async () =>
    getDb()
      .select({
        id: gamesTable.id,
        title: gamesTable.title,
        raGameId: gamesTable.raGameId,
        heroUrl: gamesTable.heroUrl,
      })
      .from(gamesTable),
  );
  const matched = games.filter(
    (game): game is typeof game & { raGameId: number } => game.raGameId !== null,
  );
  if (matched.length === 0) return 0;

  raSyncChainRunning = true;
  // Desligado a propósito: encolar devuelve el conteo al instante y la cadena
  // (un minuto largo de biblioteca retro) corre por detrás. El flag se libera
  // pase lo que pase para no dejar el candado echado toda la sesión.
  void (async () => {
    try {
      await runRaSyncChain(matched);
    } finally {
      raSyncChainRunning = false;
    }
  })();

  return matched.length;
};

// Refresco de UN juego (el botón de la ficha, y el cierre de sesión de un
// juego emulado): re-intenta el emparejado si hace falta y sincroniza.
//
// forceRematch: el botón de la ficha SÍ re-intenta el emparejado aunque ya
// se hubiera preguntado ("hoy le han publicado set y lo quiero ya"); el
// cierre de sesión no — bajar las listas de consola en cada cierre de un
// juego sin set sería pagar cientos de KB por un no casi seguro (el barrido
// periódico ya lo reintenta con su cadencia).
export const refreshRaForGame = async (
  gameId: number,
  notify: boolean,
  forceRematch = false,
): Promise<boolean> => {
  if (!hasRaCredentials()) return false;

  try {
    const [game] = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          releaseYear: gamesTable.releaseYear,
          officialPlatforms: gamesTable.officialPlatforms,
          raGameId: gamesTable.raGameId,
          raCheckedAt: gamesTable.raCheckedAt,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1),
    );
    if (!game) return false;

    let raGameId = game.raGameId;
    if (raGameId === null) {
      // Un juego NUNCA preguntado (raCheckedAt null — el alta de hace un
      // momento) siempre merece su intento: sin esto, un DS recién añadido
      // esperaba al próximo arranque para emparejarse. El force solo
      // distingue RE-preguntar lo ya negado (el botón de la ficha) de no
      // repagar listas en cada cierre de sesión de un juego sin set.
      if (!forceRematch && game.raCheckedAt !== null) return false;
      const consoleIds = raConsoleIdsForPlatforms(game.officialPlatforms);
      if (consoleIds.length === 0) return false;
      const lists = new Map<number, RaGameListEntry[]>();
      for (const consoleId of consoleIds) {
        lists.set(consoleId, await getRaGameList(consoleId));
      }
      raGameId = matchAgainstLists(game, lists, consoleIds);
      await withDbAccess(async () =>
        getDb()
          .update(gamesTable)
          .set({ raGameId, raCheckedAt: new Date() })
          .where(eq(gamesTable.id, gameId)),
      );
      if (raGameId === null) return false;
    }

    await syncRaGame({ id: game.id, title: game.title, raGameId, heroUrl: game.heroUrl }, notify);
    return true;
  } catch (error) {
    console.warn('[ra] fallo refrescando un juego:', error);
    return false;
  }
};
