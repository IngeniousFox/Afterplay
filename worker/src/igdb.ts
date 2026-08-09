import type { IgdbCredentials } from './tenants';

// IGDB desde el Worker, NUNCA desde el navegador (§6.4). Las claves de Twitch
// son secretos: si la PWA hablara directamente con IGDB tendría que llevarlas
// en el bundle, que es lo mismo que publicarlas.
//
// Y las claves son DEL INQUILINO, no del despliegue: entran por parámetro
// desde tenants.ts. Con unas compartidas, las búsquedas de uno gastaban la
// cuota de la aplicación de Twitch del otro.

const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';

export const igdbImageUrl = (
  imageId: string,
  size: 'cover_big' | '1080p' | 'screenshot_huge',
): string => `${IMAGE_BASE}/t_${size}/${imageId}.webp`;

// El token de Twitch, cacheado POR clientId.
//
// Ojo con la regla 1 del §5.2 (nada de estado de módulo entre peticiones): esa
// regla protege contra servirle a un inquilino datos de otro. La clave de la
// caché es el propio clientId, así que dos inquilinos con credenciales
// distintas no pueden compartir token ni por accidente — y ahora que cada uno
// trae las suyas, eso ha dejado de ser una precaución para ser el mecanismo
// que los separa. Un token de Twitch tampoco es un dato de nadie: abre un
// catálogo público.
type CachedToken = { token: string; expiresAt: number };
const tokenByClientId = new Map<string, CachedToken>();

const getToken = async (igdb: IgdbCredentials, now: number): Promise<string> => {
  const cached = tokenByClientId.get(igdb.clientId);
  if (cached && cached.expiresAt > now) return cached.token;

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: igdb.clientId,
      client_secret: igdb.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) throw new Error(`Twitch devolvió ${response.status}`);

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenByClientId.set(igdb.clientId, {
    token: data.access_token,
    // Un minuto de margen: un token que caduca a mitad de vuelo se ve como un
    // 401 esporádico y desconcertante.
    expiresAt: now + (data.expires_in - 60) * 1000,
  });
  return data.access_token;
};

const igdbRequest = async <T>(
  igdb: IgdbCredentials,
  endpoint: string,
  body: string,
  now: number,
): Promise<T> => {
  const token = await getToken(igdb, now);
  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': igdb.clientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (!response.ok) throw new Error(`IGDB ${endpoint} devolvió ${response.status}`);
  return (await response.json()) as T;
};

// ── Capturas y tráiler ─────────────────────────────────────────────────────

// Menor = mejor. Portado tal cual del escritorio: se recorre en orden y gana
// la primera que encaje.
const TRAILER_RANKS: [RegExp, number][] = [
  [/launch\s*trailer/i, 0],
  [/story\s*trailer/i, 1],
  [/gameplay\s*trailer/i, 2],
  [/(reveal|announcement)\s*trailer/i, 3],
  [/^\s*trailer\s*$/i, 4],
  [/trailer/i, 5],
  [/gameplay/i, 6],
  [/teaser/i, 7],
];

// Material que no es "el tráiler del juego": contenido posterior al
// lanzamiento, piezas de prensa y todo lo que habla SOBRE el juego en vez de
// ser el juego.
const TRAILER_REJECTED =
  /dev\s*diary|accolades|update|season|dlc|expansion|pass|episode|patch|behind the|making of|soundtrack|interview|tga\s*\d{4}|awards/i;

const trailerScore = (name: string | undefined): number => {
  const label = name ?? '';
  if (TRAILER_REJECTED.test(label)) return 90;
  for (const [pattern, rank] of TRAILER_RANKS) if (pattern.test(label)) return rank;
  return 8;
};

type MediaRow = {
  id: number;
  screenshots?: { image_id: string }[];
  videos?: { video_id: string; name?: string }[];
};

export type GameMedia = { screenshots: string[]; videoId: string | null };

export const getGameMedia = async (
  igdb: IgdbCredentials,
  igdbId: number,
  now: number,
): Promise<GameMedia> => {
  const rows = await igdbRequest<MediaRow[]>(
    igdb,
    'games',
    `fields screenshots.image_id, videos.video_id, videos.name; where id = ${igdbId};`,
    now,
  );

  const row = rows[0];
  if (!row) return { screenshots: [], videoId: null };

  const videos = row.videos;
  let videoId: string | null = null;
  if (videos && videos.length > 0) {
    // Empate: gana el PRIMERO. IGDB los devuelve en orden de alta, así que lo
    // de más abajo tiende a ser lo añadido después del lanzamiento.
    let best = videos[0];
    let bestScore = trailerScore(videos[0].name);
    for (const video of videos.slice(1)) {
      const score = trailerScore(video.name);
      if (score < bestScore) {
        best = video;
        bestScore = score;
      }
    }
    videoId = best.video_id;
  }

  return {
    screenshots: (row.screenshots ?? []).map((shot) => igdbImageUrl(shot.image_id, '1080p')),
    videoId,
  };
};

// ── Búsqueda de juegos ─────────────────────────────────────────────────────

// Los tipos que el buscador OFRECE. Copiado de ALLOWED_CATEGORIES en
// src/main/igdb/rank.ts, y hay que mantenerlo pegado a esa lista.
//
// Mi primera versión puso [0, 8, 9, 11] y se dejó fuera el 4 (standalone
// expansion), el 3 (bundle) y el 10 (expanded game) — o sea que reabrí en el
// móvil un agujero que el escritorio documenta como arreglado: "Marvel's
// Spider-Man: Miles Morales" y "Dead Island: Riptide" son standalone
// expansions, y no aparecían al buscarlos.
const SEARCHABLE_GAME_TYPES = [0, 3, 4, 8, 9, 10, 11];

// El texto del usuario va dentro de comillas en el body de APICalypse — una
// comilla suelta rompería (o alteraría) la query entera.
const escapeQuery = (query: string): string => query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Un log de error pegado en la caja de búsqueda mandó 13KB de stack trace como
// query e IGDB lo devolvió con un 400 que parecía un fallo de la app. Se
// recorta y se busca lo que quepa, en vez de fallar.
const MAX_QUERY_LENGTH = 150;
const SEARCH_LIMIT = 25;

type SearchRow = {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  game_type?: number;
  version_parent?: number;
  total_rating_count?: number;
};

export type IgdbSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
};

export const searchGames = async (
  igdb: IgdbCredentials,
  query: string,
  now: number,
): Promise<IgdbSearchResult[]> => {
  const escaped = escapeQuery(query.slice(0, MAX_QUERY_LENGTH).trim());
  if (escaped.length < 2) return [];

  const fields =
    'name, cover.image_id, first_release_date, game_type, version_parent, total_rating_count';

  // Dos búsquedas y se combinan, igual que el escritorio: el `search` de IGDB
  // pondera relevancia de texto pero no hace bien el "a medio escribir"
  // (buscar "pragmat" no encuentra "Pragmata" hasta completar la palabra),
  // y el `~ *"..."*` es un "contiene" literal que sí encuentra prefijos. La
  // primera aporta tolerancia a erratas; la segunda, que no se pierda nada por
  // ir todavía tecleando.
  const [byRelevance, byWildcard] = await Promise.all([
    igdbRequest<SearchRow[]>(
      igdb,
      'games',
      `fields ${fields}; search "${escaped}"; limit 50;`,
      now,
    ),
    igdbRequest<SearchRow[]>(
      igdb,
      'games',
      `fields ${fields}; where name ~ *"${escaped}"*; limit 50;`,
      now,
    ),
  ]);

  const seen = new Map<number, SearchRow>();
  for (const row of [...byRelevance, ...byWildcard]) {
    if (seen.has(row.id)) continue;
    if (row.version_parent !== undefined) continue;
    if (!SEARCHABLE_GAME_TYPES.includes(row.game_type ?? 0)) continue;
    seen.set(row.id, row);
  }

  // Orden por popularidad y no por el de IGDB: buscar "mario" en orden de
  // relevancia textual devuelve antes cualquier fangame con "Mario" en el
  // título que el juego que estás buscando.
  return [...seen.values()]
    .sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0))
    .slice(0, SEARCH_LIMIT)
    .map((row) => ({
      igdbId: row.id,
      title: row.name,
      coverUrl: row.cover ? igdbImageUrl(row.cover.image_id, 'cover_big') : null,
      releaseYear: row.first_release_date
        ? new Date(row.first_release_date * 1000).getUTCFullYear()
        : null,
    }));
};

// ── La saga ────────────────────────────────────────────────────────────────

// Las reediciones ("Collector's Edition", "GOTY"…) se pliegan sobre su
// capítulo en vez de ocupar hueco propio. Los DLC (1), expansiones (2), packs
// (3, 13) y updates (14) siguen fuera: no son ni capítulo ni edición.
const EDITION_GAME_TYPES = [8, 9, 10, 11];

// Hay mainlines largas de verdad (Pokémon ronda la treintena) y un carrusel
// infinito no es una saga, es un catálogo.
const COLLECTION_GAMES_LIMIT = 25;
// Margen de seis a uno sobre el tope de capítulos, para que el recorte lo
// decida siempre el número de capítulos y no el de filas pedidas.
const COLLECTION_ROWS_LIMIT = 150;

type CollectionRow = {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  game_type?: number;
  parent_game?: number;
};

export type CollectionGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
};

export const getCollectionGames = async (
  igdb: IgdbCredentials,
  collectionIds: number[],
  now: number,
): Promise<CollectionGame[]> => {
  // Los ids van dentro del cuerpo de la query, así que se comprueba que son
  // enteros de verdad: no hay parámetros preparados en la API de IGDB.
  if (collectionIds.some((id) => !Number.isInteger(id))) return [];
  if (collectionIds.length === 0) return [];

  const key = [...collectionIds].sort((a, b) => a - b).join(',');
  const body =
    `fields name, cover.image_id, first_release_date, game_type, parent_game; ` +
    // La lista sobre un campo ESCALAR es "cualquiera de estos": nada que ver
    // con el `(…)` de contención sobre `collections`, que es un array. Misma
    // sintaxis, dos significados.
    `where collections = (${key}) & version_parent = null ` +
    `& game_type = (0,${EDITION_GAME_TYPES.join(',')}); ` +
    `sort first_release_date asc; limit ${COLLECTION_ROWS_LIMIT};`;

  const rows = await igdbRequest<CollectionRow[]>(igdb, 'games', body, now);

  // Solo los capítulos (game_type 0). Las ediciones se descartan aquí: en el
  // escritorio se pliegan dentro de su capítulo para poder listarlas al
  // desplegar, pero en el móvil esa lista anidada no se enseña, así que
  // guardarlas sería cargar el payload sin que nadie las mire.
  const chapters = rows
    .filter((row) => (row.game_type ?? 0) === 0)
    .map((row) => ({
      igdbId: row.id,
      title: row.name,
      coverUrl: row.cover ? igdbImageUrl(row.cover.image_id, 'cover_big') : null,
      releaseYear: row.first_release_date
        ? new Date(row.first_release_date * 1000).getUTCFullYear()
        : null,
    }));

  return chapters
    .sort((a, b) => (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999))
    .slice(0, COLLECTION_GAMES_LIMIT);
};
