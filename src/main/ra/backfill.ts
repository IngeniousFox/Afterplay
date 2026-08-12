import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable, iterationsTable } from '../db/schema';
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
// emparejar (el barrido lo reintenta cada pocos días, y un juego sin logros
// se nota) a colgarle el set de otro, que sí es irrecuperable en la práctica:
// la ficha enseña los logros de otro juego y nada delata que estén mal.
const MIN_RA_SIMILARITY = 0.8;

// Distancia por debajo de la cual dos consolas NO están decidiendo nada: sin
// año que desempate, tres sets con el título exacto puntúan 1.00 clavado y el
// "ganador" acaba siendo el que IGDB puso antes en officialPlatforms. Un
// margen pequeño (y no la igualdad exacta) porque un 1.00 contra un 0.97 de
// otra consola tampoco es una decisión: es ruido de bigramas.
const AMBIGUOUS_MARGIN = 0.05;

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

// Un set candidato CON la consola de la que sale: el desempate y el aviso de
// abajo razonan por consola, no por raGameId suelto.
type ConsoleMatch = { consoleId: number; raGameId: number };

// El veredicto del emparejado. 'ambiguous' es un caso aparte de 'none' a
// propósito: quien llama todavía puede romper el empate con un dato que aquí
// no está (la plataforma que el usuario apuntó), y si no puede tiene que
// CONTARLO — un empate callado es indistinguible de "este juego no está en
// RA", y son dos cosas muy distintas.
type RaMatch =
  | { kind: 'matched'; raGameId: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; tied: ConsoleMatch[] };

// Emparejar UN juego contra las listas (ya bajadas) de sus consolas.
//
// Se puntúa por CONSOLA, no en un pool único con todas las listas aplanadas.
// La cicatriz: officialPlatforms es la lista cruda de IGDB, en SU orden, y un
// multiplataforma como Sonic the Hedgehog está con el título idéntico en Game
// Gear, Master System y Mega Drive. Sin año en las listas de RA los tres
// puntúan 1.00, y el pool aplanado se quedaba con el primero del array de
// IGDB — un sorteo. Y games solo guarda UN raGameId, así que elegir mal se
// paga dos veces: la ficha enseña el progreso de un set que no juegas, y el
// sondeo en vivo (que busca por raGameId) descarta EN SILENCIO los
// desbloqueos del set que sí.
//
// PURA y sin console a propósito: el empate no se decide aquí (falta el dato
// que lo rompe) y avisar desde dentro metía la ráfaga de warns en mitad de la
// transacción del nivel 2.
const matchAgainstLists = (
  game: MatchCandidate,
  lists: Map<number, RaGameListEntry[]>,
  consoleIds: number[],
): RaMatch => {
  const perConsole: { consoleId: number; raGameId: number; similarity: number }[] = [];
  for (const consoleId of consoleIds) {
    const candidates = lists.get(consoleId);
    if (!candidates || candidates.length === 0) continue;

    const best = findBestTitleMatch(
      candidates,
      (candidate) => candidate.title,
      // Las listas de RA no traen año: el bonus de findBestTitleMatch queda
      // siempre a cero y su score ES la similitud de nombre pelada.
      () => undefined,
      game.title,
      game.releaseYear,
    );
    if (!best) continue;

    const similarity = diceCoefficient(normalizeTitle(best.title), normalizeTitle(game.title));
    if (similarity < MIN_RA_SIMILARITY) continue;
    perConsole.push({ consoleId, raGameId: best.raGameId, similarity });
  }
  if (perConsole.length === 0) return { kind: 'none' };

  perConsole.sort((a, b) => b.similarity - a.similarity);
  const [winner] = perConsole;
  const tied = perConsole.filter(
    (entry) => winner.similarity - entry.similarity <= AMBIGUOUS_MARGIN,
  );
  if (tied.length > 1) {
    return {
      kind: 'ambiguous',
      tied: tied.map((entry) => ({ consoleId: entry.consoleId, raGameId: entry.raGameId })),
    };
  }
  return { kind: 'matched', raGameId: winner.raGameId };
};

// La válvula de escape del empate: la plataforma que TÚ apuntaste en la
// partida. Es el único dato de la casa que sabe en qué consola juegas de
// verdad — officialPlatforms es la lista COMPLETA de IGDB, así que sin esto el
// empate no es un caso raro sino el pan de cada clásico (Sonic, Aladdin,
// Mortal Kombat, Castlevania SotN en PS1 y Saturn…) y todos ellos se quedaban
// sin set para siempre.
//
// Habla poco, y hay que contarlo: el desplegable de plataforma ofrece
// "Emulated" (que es justo lo que preselecciona el alta de un juego emulado) y
// no tiene entrada para media Sega, así que muchas veces no traduce a ninguna
// consola de RA. Si no señala a EXACTAMENTE uno de los empatados, el empate
// sigue en pie: desempatar con media pista es volver a la moneda al aire, que
// es lo que se vino a quitar.
const breakTieByPlayedPlatform = (
  tied: ConsoleMatch[],
  playedPlatforms: string[],
): number | null => {
  const played = new Set(raConsoleIdsForPlatforms(playedPlatforms));
  const hits = tied.filter((entry) => played.has(entry.consoleId));
  return hits.length === 1 ? hits[0].raGameId : null;
};

// Las plataformas apuntadas de unos pocos juegos. Se pide SOLO cuando hay
// empates (un puñado, y en la mayoría de pasadas ninguno), así que el camino
// normal no paga esta consulta.
const readPlayedPlatforms = async (gameIds: number[]): Promise<Map<number, string[]>> => {
  const rows = await withDbAccess(async () =>
    getDb()
      .select({ gameId: iterationsTable.gameId, playedPlatform: iterationsTable.playedPlatform })
      .from(iterationsTable)
      .where(inArray(iterationsTable.gameId, gameIds)),
  );
  const byGame = new Map<number, string[]>();
  for (const row of rows) {
    const platforms = byGame.get(row.gameId);
    if (platforms) platforms.push(row.playedPlatform);
    else byGame.set(row.gameId, [row.playedPlatform]);
  }
  return byGame;
};

// El aviso del empate con NOMBRE de consola y no solo el id: "Mega Drive (1)"
// se entiende, "1" manda a buscar la tabla de IDs de RA. Los nombres solo los
// tiene quien haya bajado GetConsoleIDs (el nivel 2); el refresco de un juego
// suelto no baja esa tabla solo para redactar un aviso, y ahí degrada al id.
const describeTie = (tied: ConsoleMatch[], consoleNames?: Map<number, string>): string =>
  tied
    .map((entry) => {
      const name = consoleNames?.get(entry.consoleId);
      return name ? `${name} (${entry.consoleId})` : String(entry.consoleId);
    })
    .join(', ');

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

      // El emparejado es CPU pura y se decide ENTERO fuera de la transacción.
      // Antes se hacía dentro: el candado de escritura tomado mientras se
      // puntúan miles de títulos, y los avisos de empate saliendo en ráfaga
      // desde el mismo sitio.
      const decisions = withConsoles
        // Si su lista no se pudo bajar, no se marca como preguntado: que el
        // próximo arranque lo reintente.
        .filter(({ consoleIds }) => consoleIds.some((id) => lists.has(id)))
        .map(({ game, consoleIds }) => ({
          game,
          match: matchAgainstLists(game, lists, consoleIds),
        }));

      const tiedGameIds = decisions.flatMap((entry) =>
        entry.match.kind === 'ambiguous' ? [entry.game.id] : [],
      );
      const playedPlatforms =
        tiedGameIds.length > 0
          ? await readPlayedPlatforms(tiedGameIds)
          : new Map<number, string[]>();

      // raGameId null = "no está en RA" O "empate irresoluble"; `tied` solo
      // lleva algo en el segundo caso, que es el que hay que contar.
      const resolved = decisions.map(({ game, match }) => {
        if (match.kind === 'matched') {
          return { game, raGameId: match.raGameId, tied: [] as ConsoleMatch[] };
        }
        if (match.kind === 'none') return { game, raGameId: null, tied: [] as ConsoleMatch[] };
        const raGameId = breakTieByPlayedPlatform(match.tied, playedPlatforms.get(game.id) ?? []);
        return { game, raGameId, tied: raGameId === null ? match.tied : [] };
      });

      const checkedAt = new Date();
      await withDbAccess(async () =>
        getDb().transaction(async (tx) => {
          for (const { game, raGameId } of resolved) {
            await tx
              .update(gamesTable)
              .set({ raGameId, raCheckedAt: checkedAt })
              .where(eq(gamesTable.id, game.id));
          }
        }),
      );

      const matchedCount = resolved.filter((entry) => entry.raGameId !== null).length;
      if (matchedCount > 0) {
        console.log(`[ra] emparejados ${matchedCount}/${withConsoles.length} juego(s) con RA`);
      }

      // UN aviso agrupado, y fuera de la transacción: en una biblioteca retro
      // los empates son decenas y una línea por juego era una ráfaga. A estos
      // SÍ se les estampa raCheckedAt arriba, así que se reintentan con la
      // cadencia del barrido (no en cada arranque) y volverán a empatar hasta
      // que alguien apunte la plataforma que juega o exista el enlace manual
      // de la ficha (RETROACHIEVEMENTS.md §5), que hoy NO existe: no hay ni un
      // raGameId en el renderer ni en el ipc. Hasta entonces el hueco solo se
      // ve aquí — el botón de la ficha devuelve false y parece un "este juego
      // no tiene set".
      const unresolved = resolved.filter((entry) => entry.tied.length > 0);
      if (unresolved.length > 0) {
        const consoleNames = new Map<number, string>(
          consoles.map((entry) => [entry.id, entry.name]),
        );
        console.warn(
          `[ra] ${unresolved.length} juego(s) sin emparejar por empate entre consolas de RA (mejor hueco que colgarles el set de otra consola): ` +
            unresolved
              .map((entry) => `"${entry.game.title}" -> ${describeTie(entry.tied, consoleNames)}`)
              .join(' | '),
        );
      }
    }

    // ── Nivel 3: catálogo de los emparejados que no lo tienen ────────────
    // (los recién emparejados de arriba, más los que quedaran a medias de
    // una pasada anterior).
    //
    // Sin filtrar por steamAppId a propósito: tener appid de Steam NO
    // descalifica de RA — son fuentes distintas y un clásico puede tener las
    // dos (puerto en Steam y set en RA), que es justo lo que ya hacen el
    // "Sync now" de abajo y el refresco por juego. La cicatriz: aquí había un
    // isNull(steamAppId) que saltaba precisamente a los recién emparejados
    // con appid (Mega Man X, comprado en Steam y con set de SNES), y se
    // quedaban con raGameId y sin catálogo hasta que otro camino los tocara,
    // así que lo que veías dependía de quién hubiera corrido primero.
    //
    // Lo que sigue cojo y NO se arregla aquí — achievementsSyncedAt es UNA
    // marca para DOS fuentes, y se pisan en las dos direcciones:
    //
    //   · Steam -> RA: a un juego cuyo catálogo de Steam ya llegó, este nivel
    //     no le trae el de RA (la marca ya está puesta). Se lo traen el "Sync
    //     now" o el botón de la ficha.
    //   · RA -> Steam: al revés es peor, porque aquí sí se escribe. syncRaGame
    //     estampa achievementsSyncedAt (ra/sync.ts) y la pasada automática de
    //     Steam pide justo isNull(achievementsSyncedAt)
    //     (db/queries/achievements/getPendingAchievementsGames.ts), así que un
    //     juego con las dos fuentes queda fuera del backfill de catálogo de
    //     Steam para siempre. En el arranque normal no muerde: index.ts lanza
    //     la pasada de Steam antes y su cola ya se llevó su lista. Muerde
    //     cuando Steam no llegó a encolarlo — sin API key todavía, fallo de
    //     red o 429 en la cola, o el bail deliberado de steam/syncAchievements
    //     para el juego que aún no ha salido (403). Ese bail existe justo para
    //     que el próximo arranque lo vuelva a coger, y con un set de RA ya no
    //     lo consigue: su comentario ("no estampar para que el arranque lo
    //     vuelva a coger") es media verdad desde que este nivel existe. La
    //     salida que le queda al usuario es "Sync now" o jugar el juego.
    //
    // El arreglo de verdad es una marca por fuente (o una columna `source` en
    // achievements): schema y queries ajenas a este fichero.
    const pendingSync = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          raGameId: gamesTable.raGameId,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(isNull(gamesTable.achievementsSyncedAt)),
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
      const match = matchAgainstLists(game, lists, consoleIds);
      if (match.kind === 'ambiguous') {
        // Mismo desempate que el nivel 2. Si tampoco aquí desempata, hueco y
        // aviso — con los ids pelados: no compensa una petición más de
        // GetConsoleIDs por un juego suelto solo para redactarlo.
        const played = await readPlayedPlatforms([gameId]);
        raGameId = breakTieByPlayedPlatform(match.tied, played.get(gameId) ?? []);
        if (raGameId === null) {
          console.warn(
            `[ra] "${game.title}" empata entre ${match.tied.length} consolas de RA (${describeTie(match.tied)}) - sin emparejar: mejor hueco que colgarle el set de otra consola`,
          );
        }
      } else {
        raGameId = match.kind === 'matched' ? match.raGameId : null;
      }
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
