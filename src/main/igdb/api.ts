import { unixSecondsToUtcYear } from '../lib/titleMatch';
import { igdbRequest } from './client';
import { igdbImageUrl } from './images';
import { filterAndRankGames } from './rank';
import {
  igdbDetailResponseSchema,
  igdbExternalGamesResponseSchema,
  igdbGameVersionsResponseSchema,
  igdbSearchResponseSchema,
} from './schemas';
import type { IgdbGameDetail, IgdbSearchResult } from './types';

const SEARCH_FIELDS =
  'name, cover.image_id, first_release_date, platforms.name, genres.name, summary, ' +
  'category, version_parent, parent_game, collection, total_rating_count, follows, hypes';

// IGDB's own "search" ordering es sobre todo relevancia de texto — no
// distingue el juego base de sus DLC/mods/ediciones sueltas ni de morralla
// poco relevante. Se pide un banco de candidatos bastante más grande del que
// se va a mostrar para que el ranking (rank.ts) tenga margen real donde
// elegir, y luego se recorta al límite que ve el usuario.
const CANDIDATE_POOL_SIZE = 60;
const RESULT_LIMIT = 25;

// El texto del usuario va dentro de comillas en el body APICalypse — una
// comilla suelta en lo que escriba rompería (o alteraría) la query entera.
const escapeQuery = (query: string): string => query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const toReleaseYear = (unixSeconds: number | undefined): number | null =>
  unixSeconds === undefined ? null : unixSecondsToUtcYear(unixSeconds);

// El appid de Steam de un juego sale de external_games, filtrando por la
// FUENTE. Dos avisos que costaron un rato averiguar, los dos comprobados
// contra la API en vivo:
//
//  1. `external_games.category` (el campo viejo) está DEPRECADO y ya no
//     devuelve nada: `where category = 1` responde 200 con lista VACÍA, no
//     con un error. Un fallo perfectamente mudo — el backfill terminaba
//     "bien" marcando 333 juegos como comprobados y cero encontrados.
//  2. `external.steam`, que el changelog de IGDB anuncia como su sustituto,
//     NO EXISTE en la API v4: responde 400 "Invalid field name".
//
// Lo que sí funciona es `external_game_source`, cuyo id para Steam es 1
// (comprobado contra /v4/external_game_sources). Si esto vuelve a quedarse
// a cero algún día, lo primero que hay que mirar es si ese id ha cambiado.
const STEAM_SOURCE_ID = 1;

// El parseo defensivo es a propósito: el uid viaja como string por contrato
// (otras tiendas meten ahí slugs y ASINs de Amazon), y un appid no numérico
// sería un dato corrupto que no debe colarse en la DB.
const parseSteamUid = (uid: string): number | null => {
  const appId = Number(uid);
  return Number.isInteger(appId) && appId > 0 ? appId : null;
};

const steamAppIdFromExternals = (
  externals: { uid: string; external_game_source?: number }[] | undefined,
): number | null => {
  for (const external of externals ?? []) {
    if (external.external_game_source !== STEAM_SOURCE_ID) continue;
    const appId = parseSteamUid(external.uid);
    if (appId !== null) return appId;
  }
  return null;
};

export const searchGames = async (query: string): Promise<IgdbSearchResult[]> => {
  const escaped = escapeQuery(query);

  // IGDB's "search" pondera relevancia de texto y no hace bien el "a medio
  // escribir" — comprobado en vivo, buscar "pragmat" no encontraba
  // "Pragmata" (solo apareció al completar la palabra entera), justo lo
  // contrario de lo que hace falta en una caja que filtra mientras se
  // escribe. El operador `~ *"..."*` hace un "contiene" literal
  // case-insensitive, que sí encuentra prefijos/substrings a medias. Se
  // piden las dos en paralelo y se combinan: la de relevancia aporta
  // tolerancia a erratas y orden de palabras, la de wildcard aporta que no
  // se pierda nada por ir todavía a medio escribir.
  const relevanceBody = `fields ${SEARCH_FIELDS}; search "${escaped}"; limit ${CANDIDATE_POOL_SIZE};`;
  const wildcardBody = `fields ${SEARCH_FIELDS}; where name ~ *"${escaped}"*; limit ${CANDIDATE_POOL_SIZE};`;

  const [relevanceRaw, wildcardRaw] = await Promise.all([
    igdbRequest('games', relevanceBody),
    igdbRequest('games', wildcardBody),
  ]);

  const relevanceGames = igdbSearchResponseSchema.parse(relevanceRaw);
  const wildcardGames = igdbSearchResponseSchema.parse(wildcardRaw);

  // Dedupe por id — el mismo juego casi siempre sale en las dos listas.
  const gamesById = new Map<number, (typeof relevanceGames)[number]>();
  for (const game of [...relevanceGames, ...wildcardGames]) {
    gamesById.set(game.id, game);
  }

  // Cada candidato lleva los campos que rank.ts necesita para filtrar/
  // puntuar PEGADOS a los campos originales — así filterAndRankGames() puede
  // devolver los objetos completos y no hace falta volver a cruzarlos con
  // el array de partida.
  //
  // category ?? 0 y NO ?? -1: IGDB omite el campo directamente cuando vale 0
  // (main_game, el caso más común) — comprobado en vivo, "Cyberpunk 2077" no
  // trae `category` en la respuesta y aun así es category:0. Tratar "no
  // viene" como "desconocido y fuera" excluía el juego principal de CASI
  // toda búsqueda.
  const rankable = [...gamesById.values()].map((game) => ({
    ...game,
    category: game.category ?? 0,
    versionParent: game.version_parent ?? null,
    parentGame: game.parent_game ?? null,
    collection: game.collection ?? null,
    hasCover: game.cover !== undefined,
    totalRatingCount: game.total_rating_count ?? null,
    follows: game.follows ?? null,
    hypes: game.hypes ?? null,
    firstReleaseYear: toReleaseYear(game.first_release_date),
  }));

  const ranked = filterAndRankGames(rankable, query).slice(0, RESULT_LIMIT);

  return ranked.map((game) => ({
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_big') : null,
    releaseYear: game.firstReleaseYear,
    platforms: game.platforms?.map((platform) => platform.name) ?? [],
    genres: game.genres?.map((genre) => genre.name) ?? [],
    summary: game.summary ?? null,
  }));
};

export const getGameDetails = async (igdbId: number): Promise<IgdbGameDetail | null> => {
  // El id va interpolado en el body: entero obligatorio, que por ahí no se
  // cuele texto arbitrario hacia la query.
  if (!Number.isInteger(igdbId)) {
    throw new Error(`igdbId inválido: ${igdbId}`);
  }

  const body =
    `fields ${SEARCH_FIELDS}, artworks.image_id, screenshots.image_id, ` +
    `involved_companies.company.name, involved_companies.developer, involved_companies.publisher, ` +
    `external_games.uid, external_games.external_game_source; ` +
    `where id = ${igdbId};`;
  const [game] = igdbDetailResponseSchema.parse(await igdbRequest('games', body));
  if (!game) return null;

  const companies = game.involved_companies ?? [];

  // La expansión anidada trae TODAS las tiendas (Amazon, GOG, YouTube…), sin
  // poder filtrarlas en la propia query — el filtro por Steam se hace aquí
  // sobre la lista ya recibida, y no cuesta ninguna petición de más. Solo si
  // no hay nada se paga el respaldo por ediciones (ver allí el porqué).
  const directSteamAppId = steamAppIdFromExternals(game.external_games);
  const steamAppId =
    directSteamAppId ??
    (await getSteamAppIdViaEditions(igdbId).catch((error) => {
      // El appid es un extra para los logros, no un requisito del alta: si
      // esta consulta falla, el juego se da de alta igual y el backfill lo
      // recogerá luego.
      console.warn('[steam] fallo buscando el appid por ediciones (sigo sin el):', error);
      return null;
    }));

  return {
    steamAppId,
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_big') : null,
    releaseYear: toReleaseYear(game.first_release_date),
    platforms: game.platforms?.map((platform) => platform.name) ?? [],
    genres: game.genres?.map((genre) => genre.name) ?? [],
    summary: game.summary ?? null,
    developer: companies.find((entry) => entry.developer)?.company.name ?? null,
    publisher: companies.find((entry) => entry.publisher)?.company.name ?? null,
    covers: game.cover ? [igdbImageUrl(game.cover.image_id, 'cover_big')] : [],
    heroes: game.artworks?.map((artwork) => igdbImageUrl(artwork.image_id, '1080p')) ?? [],
    // 1080p en vez de screenshot_big (889×500) — mismo aspect ratio 16:9,
    // pero a resolución completa. Es una transformación de Cloudinary, no un
    // tamaño pre-generado: si la screenshot original fuera más pequeña
    // (raro, la mayoría ya vienen a 1080p o más), Cloudinary la escala hacia
    // arriba en vez de fallar — nunca peor que el tamaño de antes.
    screenshots: game.screenshots?.map((shot) => igdbImageUrl(shot.image_id, '1080p')) ?? [],
  };
};

// Tope de filas que IGDB devuelve por respuesta. Importa de verdad: un juego
// puede tener VARIAS entradas de Steam (ediciones, paquetes regionales), así
// que el número de filas no es el de juegos pedidos — el que llama trocea en
// lotes bastante menores que esto para dejar margen de sobra.
const EXTERNAL_GAMES_PAGE_LIMIT = 500;

const assertIntegerIds = (igdbIds: number[]): void => {
  for (const igdbId of igdbIds) {
    if (!Number.isInteger(igdbId)) throw new Error(`igdbId inválido: ${igdbId}`);
  }
};

// Los appids de Steam ATADOS DIRECTAMENTE a estos juegos.
const fetchSteamAppIdsDirect = async (igdbIds: number[]): Promise<Map<number, number>> => {
  const result = new Map<number, number>();
  if (igdbIds.length === 0) return result;

  const body =
    `fields game, uid; ` +
    `where game = (${igdbIds.join(',')}) & external_game_source = ${STEAM_SOURCE_ID}; ` +
    `limit ${EXTERNAL_GAMES_PAGE_LIMIT};`;
  const rows = igdbExternalGamesResponseSchema.parse(await igdbRequest('external_games', body));

  // Tocar techo significa que la respuesta viene CORTADA y hay juegos que se
  // quedarían fuera en silencio (marcados como "preguntados, no está en
  // Steam" sin haberlo estado nunca) — justo el fallo mudo que ya nos comió
  // una tarde. Se avisa fuerte en vez de dejarlo pasar.
  if (rows.length === EXTERNAL_GAMES_PAGE_LIMIT) {
    // Solo ASCII, misma convención que watcher/watcher.ts: la consola de
    // Windows no siempre usa UTF-8 y los acentos salen ilegibles.
    console.warn(
      `[steam] la respuesta de external_games toco el limite de ${EXTERNAL_GAMES_PAGE_LIMIT} filas - hay appids sin leer, baja el tamano de lote`,
    );
  }

  for (const row of rows) {
    // El primero gana: con varias entradas de Steam para el mismo juego
    // (paquetes regionales), cualquiera sirve de puente a los logros.
    if (result.has(row.game)) continue;
    const appId = parseSteamUid(row.uid);
    if (appId !== null) result.set(row.game, appId);
  }
  return result;
};

// Respaldo: el appid que lleva alguna EDICIÓN del juego.
//
// IGDB modela las ediciones como juegos aparte enlazados con version_parent,
// y el puerto de PC a menudo vive ahí en vez de en la ficha base — el caso
// real que lo destapó: "Horizon Zero Dawn" (base, PS4) no tiene Steam, pero
// "Horizon Zero Dawn: Complete Edition" sí (appid 1151640). Lo mismo con
// Forbidden West, Dark Souls (Prepare to Die) y Dead Island (GOTY).
//
// Se sigue SOLO version_parent, que es "esta es una edición de aquel juego".
// A propósito NO se usa parent_game (DLC, expansiones y remasters cuelgan de
// ahí: un remaster es otro producto con otros logros) ni el emparejado por
// nombre, que es justo como se cuelan juegos equivocados.
const fetchSteamAppIdsViaEditions = async (igdbIds: number[]): Promise<Map<number, number>> => {
  const result = new Map<number, number>();
  if (igdbIds.length === 0) return result;

  const versions = igdbGameVersionsResponseSchema.parse(
    await igdbRequest(
      'games',
      `fields id, version_parent; where version_parent = (${igdbIds.join(',')}); limit ${EXTERNAL_GAMES_PAGE_LIMIT};`,
    ),
  );
  if (versions.length === 0) return result;

  const appIdByVersion = await fetchSteamAppIdsDirect(versions.map((version) => version.id));

  for (const version of versions) {
    if (result.has(version.version_parent)) continue;
    const appId = appIdByVersion.get(version.id);
    if (appId !== undefined) result.set(version.version_parent, appId);
  }
  return result;
};

// Appids de Steam de un LOTE de juegos (el backfill de logros). Devuelve
// igdbId -> appid solo para los que están en Steam; los ausentes del mapa
// simplemente no están (consolas, exclusivas de otras tiendas).
export const getSteamAppIds = async (igdbIds: number[]): Promise<Map<number, number>> => {
  if (igdbIds.length === 0) return new Map();
  assertIntegerIds(igdbIds);

  const direct = await fetchSteamAppIdsDirect(igdbIds);

  // El respaldo solo se paga por los que fallaron — en una biblioteca normal
  // son un puñado, así que es una petición extra pequeña, no otra ronda.
  const missing = igdbIds.filter((igdbId) => !direct.has(igdbId));
  if (missing.length === 0) return direct;

  for (const [igdbId, appId] of await fetchSteamAppIdsViaEditions(missing)) {
    direct.set(igdbId, appId);
  }
  return direct;
};

// El appid de UN juego a través de sus ediciones — para el alta, donde la
// consulta directa ya viajó gratis dentro del detalle (getGameDetails) y solo
// hace falta el respaldo si aquella no encontró nada.
export const getSteamAppIdViaEditions = async (igdbId: number): Promise<number | null> => {
  assertIntegerIds([igdbId]);
  return (await fetchSteamAppIdsViaEditions([igdbId])).get(igdbId) ?? null;
};
