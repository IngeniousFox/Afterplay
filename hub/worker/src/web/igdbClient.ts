// Cliente de IGDB dentro del hub (F-29, §9.3). Habla con Twitch e IGDB desde
// el Durable Object con las claves que subió el escritorio de la persona;
// nunca desde el navegador.
//
// REGLAS:
//   · Las claves llegan por `loadCredentials` (ya descifradas, solo en memoria)
//     y jamás se registran ni salen en un error: los mensajes de este módulo
//     solo llevan estados HTTP.
//   · El token de Twitch (~60 días) se guarda en memoria del objeto con su
//     caducidad. Si cambian las claves se descarta. Una petición de token en
//     vuelo se comparte.
//   · Cada petición tiene un tiempo máximo (`timeoutMs`), con `fetch`
//     inyectable para los tests.
//   · Sin claves: `igdb_not_configured`. Twitch/IGDB caído, lento o que
//     rechaza: `igdb_unavailable`.

import { HubError } from '../../../core/hub';
import type { GameMedia, IgdbSearchHit } from '../../../../src/shared/api/v2/igdb';

export interface IgdbKeys {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface IgdbClientOptions {
  /** Las claves de la persona, o null si ningún PC las ha subido. */
  readonly loadCredentials: () => Promise<IgdbKeys | null>;
  readonly now: () => number;
  /** Para los tests; por defecto el `fetch` global. */
  readonly fetch?: typeof fetch;
  /** Tiempo máximo de cada petición a Twitch o IGDB. */
  readonly timeoutMs?: number;
}

export const IGDB_TIMEOUT_MS = 8000;
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_BASE_URL = 'https://api.igdb.com/v4';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';
/** Margen antes de la caducidad: un token que muere a mitad de vuelo es un 401 raro. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export const igdbImageUrl = (
  imageId: string,
  size: 'cover_big' | '1080p' | 'screenshot_huge',
): string => `${IMAGE_BASE}/t_${size}/${imageId}.webp`;

const notConfigured = (): HubError =>
  new HubError(
    'igdb_not_configured',
    'IGDB no está configurado en este hub: abre Afterplay en tu PC una vez',
  );
const unavailable = (what: string): HubError =>
  new HubError('igdb_unavailable', `IGDB no está disponible ahora mismo (${what})`);

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
  /** Con qué claves se pidió: si cambian, el token ya no vale. */
  readonly clientId: string;
  readonly clientSecret: string;
}

export class IgdbClient {
  private cached: CachedToken | null = null;
  private inFlight: Promise<CachedToken> | null = null;

  constructor(private readonly options: IgdbClientOptions) {}

  /**
   * El `fetch` inyectado o el global. El global se llama SUELTO: en Workers,
   * `fetch` invocado como método de otro objeto (`this.fetchImpl(...)` con el
   * global dentro) lanza "Illegal invocation", que aquí parecería "sin red".
   */
  private get fetchImpl(): typeof fetch {
    return this.options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** `fetch` con tope de tiempo (la lectura del cuerpo cuenta dentro del plazo). */
  private async timed<T>(
    url: string,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
    what: string,
  ): Promise<{ status: number; value: T | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? IGDB_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) return { status: response.status, value: null };
      return { status: response.status, value: await read(response) };
    } catch (error) {
      // Al cliente, ni el mensaje ni la URL. Al log, solo el tipo de error y
      // su mensaje: las claves van en el cuerpo, que un error de fetch no cita.
      console.warn(
        `igdb: ${what} falló: ${error instanceof Error ? `${error.name}: ${error.message}` : 'desconocido'}`,
      );
      throw unavailable(controller.signal.aborted ? `${what}: tiempo agotado` : `${what}: sin red`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestToken(keys: IgdbKeys): Promise<CachedToken> {
    const { status, value } = await this.timed(
      TWITCH_TOKEN_URL,
      {
        method: 'POST',
        body: new URLSearchParams({
          client_id: keys.clientId,
          client_secret: keys.clientSecret,
          grant_type: 'client_credentials',
        }),
      },
      (response) => response.json() as Promise<unknown>,
      'Twitch',
    );
    const data = value as { access_token?: unknown; expires_in?: unknown } | null;
    if (!data || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
      // 400/403 de Twitch = claves rechazadas: no se arregla reintentando.
      throw unavailable(`Twitch respondió ${status}`);
    }
    return {
      token: data.access_token,
      expiresAt: this.options.now() + data.expires_in * 1000,
      clientId: keys.clientId,
      clientSecret: keys.clientSecret,
    };
  }

  private async getToken(keys: IgdbKeys): Promise<string> {
    const cached = this.cached;
    if (
      cached &&
      cached.clientId === keys.clientId &&
      cached.clientSecret === keys.clientSecret &&
      this.options.now() < cached.expiresAt - TOKEN_MARGIN_MS
    ) {
      return cached.token;
    }
    this.inFlight ??= this.requestToken(keys).finally(() => {
      this.inFlight = null;
    });
    const fresh = await this.inFlight;
    // Si las claves cambiaron mientras tanto, ese token no es de estas claves.
    if (fresh.clientId !== keys.clientId || fresh.clientSecret !== keys.clientSecret) {
      return this.getToken(keys);
    }
    this.cached = fresh;
    return fresh.token;
  }

  /** Una consulta APICalypse a IGDB. Un 401 descarta el token y reintenta UNA vez. */
  private async query<T>(endpoint: string, body: string): Promise<T> {
    const keys = await this.options.loadCredentials();
    if (!keys) throw notConfigured();
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(keys);
      const { status, value } = await this.timed(
        `${IGDB_BASE_URL}/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Client-ID': keys.clientId,
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body,
        },
        (response) => response.json() as Promise<T>,
        'IGDB',
      );
      if (value !== null) return value;
      if (status === 401 && attempt === 0) {
        this.cached = null;
        continue;
      }
      throw unavailable(`IGDB ${endpoint} respondió ${status}`);
    }
  }

  // ── Búsqueda ──────────────────────────────────────────────────────────────

  /**
   * Los tipos que el buscador OFRECE. Copiado de ALLOWED_CATEGORIES en
   * src/main/igdb/rank.ts (y de la 1.x): hay que mantenerlo pegado a esa lista
   * (incluye las standalone expansions, 4, y los bundles, 3).
   */
  static readonly SEARCHABLE_GAME_TYPES = [0, 3, 4, 8, 9, 10, 11];
  static readonly MAX_QUERY_LENGTH = 150;
  static readonly SEARCH_LIMIT = 25;

  async search(text: string): Promise<IgdbSearchHit[]> {
    // El texto va entre comillas en el cuerpo APICalypse: una comilla suelta
    // rompería (o alteraría) la consulta entera.
    const escaped = text
      .slice(0, IgdbClient.MAX_QUERY_LENGTH)
      .trim()
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    if (escaped.length < 2) return [];

    const fields =
      'name, cover.image_id, first_release_date, game_type, version_parent, total_rating_count';
    // Dos búsquedas combinadas, como el escritorio: `search` tolera erratas y
    // `name ~ *"..."*` encuentra prefijos de lo que aún se está tecleando.
    const [byRelevance, byWildcard] = await Promise.all([
      this.query<SearchRow[]>('games', `fields ${fields}; search "${escaped}"; limit 50;`),
      this.query<SearchRow[]>('games', `fields ${fields}; where name ~ *"${escaped}"*; limit 50;`),
    ]);

    const seen = new Map<number, SearchRow>();
    for (const row of [...byRelevance, ...byWildcard]) {
      if (seen.has(row.id)) continue;
      if (row.version_parent !== undefined) continue;
      if (!IgdbClient.SEARCHABLE_GAME_TYPES.includes(row.game_type ?? 0)) continue;
      seen.set(row.id, row);
    }
    // Por popularidad y no por relevancia de texto: buscar "mario" no debe
    // poner un fangame antes que el juego.
    return [...seen.values()]
      .sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0))
      .slice(0, IgdbClient.SEARCH_LIMIT)
      .map(toResult);
  }

  // ── Saga ──────────────────────────────────────────────────────────────────

  /** Los capítulos de las colecciones de IGDB dadas, por año (hasta 25). */
  async collectionGames(collectionIds: readonly number[]): Promise<IgdbSearchHit[]> {
    // Los ids van dentro del cuerpo de la consulta: se comprueba que son
    // enteros de verdad (la API de IGDB no tiene parámetros preparados).
    if (collectionIds.length === 0 || collectionIds.some((id) => !Number.isSafeInteger(id))) {
      return [];
    }
    const key = [...collectionIds].sort((a, b) => a - b).join(',');
    const rows = await this.query<SearchRow[]>(
      'games',
      `fields name, cover.image_id, first_release_date, game_type, parent_game; ` +
        `where collections = (${key}) & version_parent = null ` +
        `& game_type = (0,${EDITION_GAME_TYPES.join(',')}); ` +
        `sort first_release_date asc; limit ${COLLECTION_ROWS_LIMIT};`,
    );
    // Solo capítulos (game_type 0): las ediciones se pliegan sobre su capítulo
    // y la PWA no enseña esa lista anidada.
    return rows
      .filter((row) => (row.game_type ?? 0) === 0)
      .map(toResult)
      .sort((a, b) => (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999))
      .slice(0, COLLECTION_GAMES_LIMIT);
  }

  // ── Capturas y tráiler ────────────────────────────────────────────────────

  async media(igdbId: number): Promise<GameMedia> {
    if (!Number.isSafeInteger(igdbId)) return { screenshots: [], videoId: null };
    const rows = await this.query<MediaRow[]>(
      'games',
      `fields screenshots.image_id, videos.video_id, videos.name; where id = ${igdbId};`,
    );
    const row = rows[0];
    if (!row) return { screenshots: [], videoId: null };

    let videoId: string | null = null;
    const videos = row.videos;
    if (videos && videos.length > 0) {
      // Empate: gana el PRIMERO (IGDB los da por orden de alta; lo de más abajo
      // suele ser posterior al lanzamiento).
      let best = videos[0];
      let bestScore = trailerScore(best.name);
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
  }
}

// Las reediciones se pliegan sobre su capítulo; DLC, expansiones, packs y
// updates quedan fuera.
const EDITION_GAME_TYPES = [8, 9, 10, 11];
const COLLECTION_GAMES_LIMIT = 25;
// Seis a uno sobre el tope de capítulos: que el recorte lo decida el número de
// capítulos y no el de filas pedidas.
const COLLECTION_ROWS_LIMIT = 150;

interface SearchRow {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  game_type?: number;
  version_parent?: number;
  total_rating_count?: number;
}

const toResult = (row: SearchRow): IgdbSearchHit => ({
  igdbId: row.id,
  title: row.name,
  coverUrl: row.cover ? igdbImageUrl(row.cover.image_id, 'cover_big') : null,
  releaseYear: row.first_release_date
    ? new Date(row.first_release_date * 1000).getUTCFullYear()
    : null,
});

interface MediaRow {
  id: number;
  screenshots?: { image_id: string }[];
  videos?: { video_id: string; name?: string }[];
}

// Menor = mejor; gana la primera regla que encaje (portado de la 1.x).
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

// Lo que habla SOBRE el juego en vez de ser el juego (diarios de desarrollo,
// DLC, parches, premios…).
const TRAILER_REJECTED =
  /dev\s*diary|accolades|update|season|dlc|expansion|pass|episode|patch|behind the|making of|soundtrack|interview|tga\s*\d{4}|awards/i;

const trailerScore = (name: string | undefined): number => {
  const label = name ?? '';
  if (TRAILER_REJECTED.test(label)) return 90;
  for (const [pattern, rank] of TRAILER_RANKS) if (pattern.test(label)) return rank;
  return 8;
};
