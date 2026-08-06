import { unixSecondsToUtcYear } from '../lib/titleMatch';
import { igdbRequest } from './client';
import { igdbImageUrl } from './images';
import { filterAndRankGames } from './rank';
import {
  igdbCollectionGamesResponseSchema,
  igdbDetailResponseSchema,
  igdbExternalBatchResponseSchema,
  igdbExternalGamesResponseSchema,
  igdbGameVersionsResponseSchema,
  igdbSearchResponseSchema,
} from './schemas';
import type {
  CollectionGame,
  GameExternalData,
  IgdbGameDetail,
  IgdbSearchResult,
  ReleaseDatePrecision,
} from './types';

// `collections` en PLURAL, y esto no es un capricho de estilo: el campo
// `collection` (singular) que se pedía aquí desde el principio está MUERTO en
// la API v4 — comprobado en vivo el 2026-08-06, se acepta en la query y NO
// aparece jamás en la respuesta, exactamente el mismo fallo mudo que ya nos
// costó una tarde con external_games.category. Consecuencia real: el empujón
// de "saga dominante" del ranking (rank.ts) llevaba desde siempre sin
// dispararse ni una vez, porque para él todos los juegos tenían collection
// null. El vivo es `collections` y devuelve una LISTA de ids ("Super Mario
// Bros." pertenece a "Mario Bros.", "Super Mario Bros." y "Super Mario").
// Y `category` es el TERCERO del mismo grupo — comprobado en vivo el
// 2026-08-06 junto a los otros dos: se acepta y no viene nunca. El vivo es
// `game_type`, con el MISMO enum de ids (0 Main Game, 1 DLC, 2 Expansion,
// 3 Bundle, 5 Mod, 8 Remake, 9 Remaster, 11 Port, 13 Pack, 14 Update…),
// confirmado contra el endpoint /game_types.
//
// Este no era un empujón que no se disparaba: era un FILTRO que no filtraba.
// rank.ts descarta DLC, mods, expansiones y packs por categoría, y como
// `category` llegaba siempre indefinido, el `?? 0` los convertía a todos en
// "juego principal" y pasaban todos. O sea: el buscador de Add Game llevaba
// tiempo ofreciendo DLC y paquetes sueltos como si fueran juegos que dar de
// alta. Con game_type el filtro vuelve a hacer lo que dice su comentario.
const SEARCH_FIELDS =
  'name, cover.image_id, first_release_date, platforms.name, genres.name, summary, ' +
  'game_type, version_parent, parent_game, collections, total_rating_count, follows, hypes';

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

// ── Fecha de lanzamiento COMPLETA, con su precisión (PLAN-TO-PLAY.md §7bis) ──
//
// El dato ya viajaba en cada respuesta: `first_release_date` es un timestamp
// unix con día y mes que llevábamos desde el principio truncando a año. Lo que
// faltaba no era pedirlo, era saber CUÁNTO de él es de verdad — IGDB devuelve
// un timestamp concreto incluso cuando solo conoce el año, así que un juego
// "1994" a secas daría un "Dec 31, 1994" que miente.
//
// Esa precisión vive en release_dates. Y aquí hay un segundo campo muerto,
// también comprobado en vivo el 2026-08-06: `release_dates.category`, que es
// el que la documentación (y el diseño de este documento) daba por bueno, se
// acepta en la query y NUNCA viene — igual que collection. El vivo es
// `date_format`, con estos ids:
//
//   0 YYYYMMDD (día exacto) · 1 YYYYMM (solo mes) · 2 YYYY (solo año)
//   3-6 YYYYQ1..Q4 (trimestre) · 7 TBD (sin fecha; esas filas ni traen date)
//
// Un trimestre no es ni mes ni día: se degrada a año, que es lo más fino que
// se puede afirmar sin inventar.
const DATE_FORMAT_PRECISION: Record<number, ReleaseDatePrecision> = {
  0: 'day',
  1: 'month',
  2: 'year',
  3: 'year',
  4: 'year',
  5: 'year',
  6: 'year',
};

type RawReleaseDate = { date?: number; date_format?: number | { id: number } };

export type ResolvedRelease = { date: Date; precision: ReleaseDatePrecision } | null;

// La MÁS TEMPRANA de todas las fechas (una por plataforma/región) — la misma
// semántica que `first_release_date`, para que RELEASED no diga una cosa y el
// año de siempre otra. Sin fecha o sin formato conocido devuelve null: mejor
// quedarse con el año de toda la vida que estampar un día que nadie sabe.
export const resolveReleaseDate = (releaseDates: RawReleaseDate[] | undefined): ResolvedRelease => {
  let best: { seconds: number; precision: ReleaseDatePrecision } | null = null;

  for (const entry of releaseDates ?? []) {
    if (entry.date === undefined) continue;
    const formatId =
      typeof entry.date_format === 'number' ? entry.date_format : entry.date_format?.id;
    if (formatId === undefined) continue;
    const precision = DATE_FORMAT_PRECISION[formatId];
    if (precision === undefined) continue; // TBD (7) y cualquier id nuevo
    if (best === null || entry.date < best.seconds) {
      best = { seconds: entry.date, precision };
    }
  }

  return best === null ? null : { date: new Date(best.seconds * 1000), precision: best.precision };
};

const toCollections = (
  collections: { id: number; name: string }[] | undefined,
): { id: number; name: string }[] | null => (collections?.length ? collections : null);

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

// Primer intento de este arreglo: filtrar por `category` (dlc_addon/
// expansion/standalone_expansion) para decidir cuándo un `parent_game` debe
// GANARLE al appid propio. Comprobado en vivo contra la API y descartado: la
// entrada real de "The Binding of Isaac: Repentance" (igdbId 109241) viene
// con category = 0 (main_game) pese a ser, a todos los efectos de Steam, el
// contenido de una expansión — la categoría la rellena la comunidad y aquí
// no es de fiar. Lo que SÍ es de fiar es la relación en sí: `parent_game` es
// justo el campo con el que IGDB documenta "el juego base de esta versión",
// así que ahora se sigue siempre que exista, sin mirar la categoría.

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

// Tope de la búsqueda. Ningún título real se acerca (el más largo del mundo
// ronda los 130 caracteres); lo que sí llega más largo es un accidente — el
// caso real: un log de error pegado en la caja de búsqueda mandó 13KB de
// stack trace como query e IGDB lo devolvió con un 400 que parecía un fallo
// de la app. Se recorta y se busca lo que quepa, en vez de fallar.
const MAX_QUERY_LENGTH = 150;

export const searchGames = async (query: string): Promise<IgdbSearchResult[]> => {
  const escaped = escapeQuery(query.slice(0, MAX_QUERY_LENGTH));

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
    category: game.game_type ?? 0,
    versionParent: game.version_parent ?? null,
    parentGame: game.parent_game ?? null,
    collections: game.collections ?? [],
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

// Caché corta del detalle por igdbId. Existe por un patrón muy concreto: el
// renderer ya pide este MISMO detalle en cuanto se elige un juego en Add Game
// (para pintar el formulario), y resolveGameEnrichment lo vuelve a pedir al
// pulsar "Add" — la caché del renderer (staleTime Infinity) es invisible
// desde aquí, así que sin esto el botón pagaba una segunda ida y vuelta
// completa a IGDB por algo que ya se sabía, justo en la ruta crítica que el
// comentario de más abajo dice que se cuidó de no alargar.
// TTL corto (no Infinity como el renderer): esto es para coalescer las DOS
// llamadas de una misma sesión de alta, no una caché de catálogo — un detalle
// de IGDB puede cambiar (nueva carátula, categoría corregida) y cinco
// minutos es de sobra para cualquier "reviso el formulario y pulso Add".
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const detailCache = new Map<number, { detail: IgdbGameDetail | null; expiresAt: number }>();

export const getGameDetails = async (igdbId: number): Promise<IgdbGameDetail | null> => {
  // El id va interpolado en el body: entero obligatorio, que por ahí no se
  // cuele texto arbitrario hacia la query.
  if (!Number.isInteger(igdbId)) {
    throw new Error(`igdbId inválido: ${igdbId}`);
  }

  const cached = detailCache.get(igdbId);
  if (cached && cached.expiresAt > Date.now()) return cached.detail;

  // collections.id/name pisa al `collections` pelado de SEARCH_FIELDS (la
  // expansión gana): en el detalle sí hace falta el NOMBRE de la saga, no
  // solo su id. release_dates trae la fecha completa con su precisión.
  const body =
    `fields ${SEARCH_FIELDS}, artworks.image_id, screenshots.image_id, ` +
    `collections.id, collections.name, release_dates.date, release_dates.date_format, ` +
    `involved_companies.company.name, involved_companies.developer, involved_companies.publisher, ` +
    `external_games.uid, external_games.external_game_source, ` +
    `aggregated_rating, aggregated_rating_count, rating, rating_count; ` +
    `where id = ${igdbId};`;
  const [game] = igdbDetailResponseSchema.parse(await igdbRequest('games', body));
  if (!game) {
    // También se cachea el "no existe" — un igdbId que ya no está en el
    // catálogo (lo quitaron) seguiría fallando igual en el segundo intento, y
    // así no se paga esa ida y vuelta dos veces por nada.
    detailCache.set(igdbId, { detail: null, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
    return null;
  }

  const companies = game.involved_companies ?? [];

  // AQUÍ NO SE RESUELVE EL APPID DE LOS LOGROS, a propósito. La expansión
  // anidada de external_games ya viene en esta misma respuesta (gratis), pero
  // el appid definitivo puede necesitar 1-3 peticiones más si hay juego base
  // de por medio — y encadenarlas aquí las metía en la ruta crítica del alta,
  // que es justo lo que la volvió lenta al pulsar "Add". Se devuelven los dos
  // ingredientes crudos y quien los necesite llama a
  // resolveAchievementsSteamAppId(), que en el alta corre EN PARALELO con
  // HowLongToBeat y SteamGridDB (ver resolveGameEnrichment) — o sea, gratis
  // en tiempo de reloj. El renderer no usa el appid para nada.
  const detail: IgdbGameDetail = {
    directSteamAppId: steamAppIdFromExternals(game.external_games),
    parentIgdbId: game.parent_game ?? null,
    igdbId: game.id,
    // Sin fundir con total_rating — ver el porqué en schema.ts.
    ratingCritics: game.aggregated_rating ?? null,
    ratingCriticsCount: game.aggregated_rating_count ?? null,
    ratingUsers: game.rating ?? null,
    ratingUsersCount: game.rating_count ?? null,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_big') : null,
    releaseYear: toReleaseYear(game.first_release_date),
    release: resolveReleaseDate(game.release_dates),
    igdbCollections: toCollections(game.collections),
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
  detailCache.set(igdbId, { detail, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
  return detail;
};

// Los datos externos de un LOTE de juegos, para el refresco de Ajustes y el de
// la cabecera del Plan (PLAN-TO-PLAY.md §5.1). A diferencia del refresco de UN
// juego (que reutiliza getGameDetails, gratis porque el detalle ya viaja
// entero), aquí pedir el detalle completo de cientos de juegos sería absurdo:
// esta query trae SOLO lo que se guarda —notas, sinopsis, sagas y fecha con
// precisión— y con `where id = (...)` una biblioteca entera cabe en 1-2
// peticiones. Por eso este backfill no necesita cola, ni progreso, ni botón de
// parar como los logros: termina en segundos.
//
// La sinopsis y la fecha completa viajan en el MISMO viaje que las notas a
// propósito (§7bis): cero proceso nuevo, cero peticiones extra, cero código
// específico para rellenar los juegos que ya existían.
//
// 400 por petición y no el límite real de IGDB (500): aquí una fila es un
// juego exacto (id único, sin el problema de external_games de varias filas
// por juego), pero el margen evita vivir pegado al tope por si IGDB lo baja.
const EXTERNAL_BATCH_SIZE = 400;

export const getGameExternalBatch = async (
  igdbIds: number[],
): Promise<Map<number, GameExternalData>> => {
  assertIntegerIds(igdbIds);
  const result = new Map<number, GameExternalData>();

  for (let start = 0; start < igdbIds.length; start += EXTERNAL_BATCH_SIZE) {
    const chunk = igdbIds.slice(start, start + EXTERNAL_BATCH_SIZE);
    const body =
      `fields aggregated_rating, aggregated_rating_count, rating, rating_count, summary, ` +
      `first_release_date, collections.id, collections.name, ` +
      `release_dates.date, release_dates.date_format; ` +
      `where id = (${chunk.join(',')}); limit ${chunk.length};`;
    const rows = igdbExternalBatchResponseSchema.parse(await igdbRequest('games', body));

    for (const row of rows) {
      const release = resolveReleaseDate(row.release_dates);
      result.set(row.id, {
        ratingCritics: row.aggregated_rating ?? null,
        ratingCriticsCount: row.aggregated_rating_count ?? null,
        ratingUsers: row.rating ?? null,
        ratingUsersCount: row.rating_count ?? null,
        summary: row.summary ?? null,
        igdbCollections: toCollections(row.collections),
        releaseYear: toReleaseYear(row.first_release_date),
        releaseDate: release?.date ?? null,
        releaseDatePrecision: release?.precision ?? null,
      });
    }
  }
  return result;
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
  // Mismo aviso que el camino directo (fetchSteamAppIdsDirect): al tocar el
  // límite, hay ediciones sin leer y esos juegos quedan marcados como "no está
  // en Steam" sin estarlo — sin logros y sin pista de por qué. Solo ASCII, que
  // la consola de Windows no siempre usa UTF-8.
  if (versions.length === EXTERNAL_GAMES_PAGE_LIMIT) {
    console.warn(
      `[steam] la respuesta de ediciones toco el limite de ${EXTERNAL_GAMES_PAGE_LIMIT} filas - hay appids de ediciones sin leer, baja el tamano de lote`,
    );
  }
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

// EL appid con el que se piden los logros de un juego — el que acaba en la
// columna steamAppId. No siempre es el suyo propio, y ese es todo el asunto:
//
//   · Sin juego base: el propio si consta y, si no, el de alguna edición
//     (Horizon Zero Dawn, cuyo puerto de PC vive en la "Complete Edition").
//   · CON juego base: manda el del base. Comprobado en vivo con "The Binding
//     of Isaac: Repentance" (igdbId 109241) — su propio appid (1426300)
//     existe pero GetSchemaForGame lo devuelve VACÍO; los logros están todos
//     en "Rebirth" (250900), que es su parent_game. Un appid con catálogo
//     vacío es peor que ninguno: parece "comprobado y sin logros" en vez de
//     "hay que mirar en otro sitio".
//
// El orden importa para el RELOJ, no solo para el resultado: con juego base
// se prueba primero su vía directa, que es UNA petición (~180ms medidos) y
// resuelve el caso normal. Los respaldos, que son los caros, solo se pagan si
// aquello falla — y se piden A LA VEZ, porque son independientes entre sí.
export const resolveAchievementsSteamAppId = async (
  igdbId: number,
  parentIgdbId: number | null,
  directSteamAppId: number | null,
): Promise<number | null> => {
  if (parentIgdbId === null) {
    return directSteamAppId ?? (await getSteamAppIdViaEditions(igdbId));
  }

  const parentDirect = (await fetchSteamAppIdsDirect([parentIgdbId])).get(parentIgdbId);
  if (parentDirect !== undefined) return parentDirect;

  const [parentViaEditions, ownViaEditions] = await Promise.all([
    getSteamAppIdViaEditions(parentIgdbId),
    // Solo si el propio no constaba ya: pedirlo teniéndolo sería una
    // petición tirada.
    directSteamAppId === null ? getSteamAppIdViaEditions(igdbId) : Promise.resolve(null),
  ]);
  return parentViaEditions ?? directSteamAppId ?? ownViaEditions;
};

// ── La saga: los miembros de una colección (PLAN-TO-PLAY.md §3) ─────────────
//
// El carrusel de la ficha y el radar semanal preguntan lo MISMO —"qué juegos
// hay en estas colecciones"— solo que con distinto filtro de fecha, así que
// comparten esta función.
//
// Los tres filtros de la query, y por qué cada uno:
//  · `collections = (ids)` — PARÉNTESIS, y esto costó una prueba en vivo:
//    con llaves `{}` la respuesta venía SIEMPRE VACÍA en cuanto había más de
//    una colección. `{}` es "contiene TODAS estas" y `()` es "contiene alguna
//    de estas" — y ningún juego pertenece a la vez a Mario, GTA y Hollow
//    Knight, así que el radar y el carrusel habrían devuelto cero para
//    cualquiera con más de una saga, en silencio y para siempre. Un juego
//    pertenece a varias colecciones ("Super Mario Bros." está en tres) y aquí
//    se quieren los de CUALQUIERA de las suyas.
//  · `game_type = 0` — solo juegos principales. Sin esto, la saga de Hollow
//    Knight salía con siete entradas de las que CINCO eran DLC (Hidden
//    Dreams, Grimm Troupe, Godmaster…): el carrusel contaría una historia
//    falsa de una saga que en realidad tiene dos juegos. (Y `game_type` y no
//    `category`, que está muerto — ver arriba.)
//  · `version_parent = null` — fuera las reediciones ("Collector's Edition"),
//    que son el mismo juego otra vez.
//
// El tope existe porque hay mainlines largas de verdad: Pokémon ronda la
// treintena y un carrusel infinito no es una saga, es un catálogo.
const COLLECTION_GAMES_LIMIT = 25;

// Caché en memoria, sin tabla (§3.5): esto es dato DECORATIVO y volátil —
// una saga puede crecer cualquier semana. Mismo TTL y mismo espíritu que
// detailCache: coalescer las visitas seguidas a la misma ficha, no montar un
// catálogo local que luego haya que mantener.
const collectionCache = new Map<string, { games: CollectionGame[]; expiresAt: number }>();
const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1000;

type CollectionRow = {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  release_dates?: { date?: number; date_format?: number | { id: number } }[];
  collections?: number[];
  game_type?: number;
  parent_game?: number;
};

const toCollectionGame = (row: CollectionRow): CollectionGame => {
  const release = resolveReleaseDate(row.release_dates);
  return {
    igdbId: row.id,
    title: row.name,
    coverUrl: row.cover ? igdbImageUrl(row.cover.image_id, 'cover_big') : null,
    releaseYear: toReleaseYear(row.first_release_date),
    releaseDate: release?.date ?? null,
    releaseDatePrecision: release?.precision ?? null,
    collectionIds: row.collections ?? [],
    editions: [],
  };
};

// Orden cronológico de salida (§3.2): NO se inventan etiquetas de
// secuela/precuela porque IGDB no tiene ese enlace — hay colección y fechas, y
// con eso la saga se cuenta sola. Lo anterior al juego que estás mirando es su
// precuela de facto; lo posterior, su secuela.
const byReleaseAsc = (a: CollectionGame, b: CollectionGame): number => {
  // Los sin fecha (anunciados en TBD) al final: no tienen sitio en una línea
  // temporal, y colarlos al principio con un 0 sería justo lo contrario.
  const left =
    a.releaseDate?.getTime() ?? (a.releaseYear !== null ? Date.UTC(a.releaseYear, 0) : Infinity);
  const right =
    b.releaseDate?.getTime() ?? (b.releaseYear !== null ? Date.UTC(b.releaseYear, 0) : Infinity);
  return left - right || a.title.localeCompare(b.title);
};

// ── Capítulos vs. EDICIONES de un capítulo ──
//
// `game_type = 0` (solo juegos principales) dejaba fuera algo que sí es parte
// de tu saga: la edición concreta que tienes tú. Comprobado en vivo el
// 2026-08-06 con la colección 3000 (Monument Valley): con el filtro viejo
// salían tres filas —MV, MV II, MV III— y "Monument Valley: Panoramic
// Edition", que es la que está en Steam y la que el usuario había dado de
// alta, no aparecía por ningún lado. Ni siquiera se marcaba a sí misma con el
// "YOU'RE HERE" al abrir su propia ficha: su saga la ignoraba.
//
// La ficha del vivo lo explica entera: id 203331, `game_type: 10` (Expanded
// Game), `parent_game: 8900` (Monument Valley), `version_parent: null` — o
// sea que el `version_parent = null` que había aquí para colar ediciones NO
// las cuela, porque IGDB engancha estas por `parent_game`. Quien filtraba de
// verdad era `game_type`.
//
// Estos cuatro tipos no son otro capítulo: son el MISMO en otra caja, y por
// eso no ganan hueco propio en la línea temporal —eso convertiría una saga de
// tres en una lista de siete con la misma carátula repetida— sino que se
// pliegan sobre su capítulo. Los DLC (1), expansiones (2), packs (3, 13) y
// updates (14) siguen fuera: esos no son ni capítulo ni edición.
const EDITION_GAME_TYPES = [8, 9, 10, 11] as const;

// Filas pedidas a IGDB, que ya no son lo mismo que capítulos devueltos: una
// saga con muchas reediciones gasta filas sin sumar huecos. El margen sobre
// COLLECTION_GAMES_LIMIT es de seis a uno para que el recorte lo decida
// siempre el tope de capítulos y no el de filas — medido en vivo, las peores
// (Resident Evil, Call of Duty, Final Fantasy, Super Mario) van de dos a
// tres filas por capítulo.
const COLLECTION_ROWS_LIMIT = 150;

export const getCollectionGames = async (collectionIds: number[]): Promise<CollectionGame[]> => {
  assertIntegerIds(collectionIds);
  if (collectionIds.length === 0) return [];

  const key = [...collectionIds].sort((a, b) => a - b).join(',');
  const cached = collectionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.games;

  const body =
    `fields name, cover.image_id, first_release_date, collections, game_type, parent_game, ` +
    `release_dates.date, release_dates.date_format; ` +
    // La lista sobre un campo ESCALAR es "cualquiera de estos" (comprobado en
    // vivo): nada que ver con el `(…)` de contención sobre `collections`, que
    // es un array. Misma sintaxis, dos significados.
    `where collections = (${key}) & version_parent = null ` +
    `& game_type = (0,${EDITION_GAME_TYPES.join(',')}); ` +
    `sort first_release_date asc; limit ${COLLECTION_ROWS_LIMIT};`;
  const rows = igdbCollectionGamesResponseSchema.parse(await igdbRequest('games', body));

  const games = foldEditionsIntoChapters(rows).sort(byReleaseAsc).slice(0, COLLECTION_GAMES_LIMIT);
  collectionCache.set(key, { games, expiresAt: Date.now() + COLLECTION_CACHE_TTL_MS });
  return games;
};

// Cada edición va a parar a su capítulo por `parent_game`. Las huérfanas —una
// reedición cuyo juego base no está en esta colección— se caen: sin capítulo
// donde plegarse no tienen sitio, y darles hueco propio sería justo el
// problema que esto viene a evitar.
const foldEditionsIntoChapters = (rows: CollectionRow[]): CollectionGame[] => {
  const chapters: CollectionGame[] = [];
  const editions: CollectionRow[] = [];
  for (const row of rows) {
    if ((row.game_type ?? 0) === 0) chapters.push(toCollectionGame(row));
    else if (row.parent_game !== undefined) editions.push(row);
  }

  const byIgdbId = new Map(chapters.map((chapter) => [chapter.igdbId, chapter]));
  // En el orden en que vinieron, que es `first_release_date asc`: si tienes
  // dos ediciones del mismo capítulo, gana la más antigua — determinista, y
  // el caso es raro de por sí.
  for (const row of editions) {
    byIgdbId.get(row.parent_game as number)?.editions.push({
      igdbId: row.id,
      title: row.name,
      coverUrl: row.cover ? igdbImageUrl(row.cover.image_id, 'cover_big') : null,
    });
  }
  return chapters;
};

// Lo que el radar sale a buscar (§4.2): juegos de estas colecciones con fecha
// FUTURA. Sin caché — corre una vez por semana, y cachear cinco minutos algo
// que se pide cada siete días no ahorra nada.
//
// Los anunciados SIN fecha (TBD) quedan fuera a propósito: son sobre todo
// fichas especulativas viejas que nadie ha vuelto a tocar, y meterlas
// convertiría el horizonte en un cajón de sastre.
export const getUpcomingCollectionGames = async (
  collectionIds: number[],
  afterSeconds: number,
): Promise<CollectionGame[]> => {
  assertIntegerIds(collectionIds);
  if (collectionIds.length === 0) return [];

  const found = new Map<number, CollectionGame>();
  // Se trocea porque el `where ... = {…}` lleva los ids en el propio cuerpo y
  // una biblioteca grande puede tener cientos de colecciones distintas.
  for (let start = 0; start < collectionIds.length; start += COLLECTION_CHUNK) {
    const chunk = collectionIds.slice(start, start + COLLECTION_CHUNK);
    const body =
      `fields name, cover.image_id, first_release_date, ` +
      `release_dates.date, release_dates.date_format, collections; ` +
      `where collections = (${chunk.join(',')}) & first_release_date > ${Math.floor(afterSeconds)} ` +
      `& game_type = 0 & version_parent = null; ` +
      `sort first_release_date asc; limit ${UPCOMING_LIMIT};`;
    const rows = igdbCollectionGamesResponseSchema.parse(await igdbRequest('games', body));
    for (const row of rows) found.set(row.id, toCollectionGame(row));
  }
  return [...found.values()].sort(byReleaseAsc);
};

// Colecciones por petición. Van en el cuerpo de la query, así que el límite
// real es la longitud del body — 200 ids son unos 1.400 caracteres, de sobra.
const COLLECTION_CHUNK = 200;
// Y el tope de filas por respuesta. 500 es el máximo de IGDB; un radar que
// devolviera 500 anuncios de golpe sería un problema distinto (y se avisa).
const UPCOMING_LIMIT = 500;
