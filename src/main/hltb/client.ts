import axios, { AxiosError, type AxiosInstance } from 'axios';

// Cliente propio de HowLongToBeat, en sustitucion del paquete hltb-client.
//
// POR QUE NO EL PAQUETE: hltb-client se quedo clavado en la 1.0.1 (no hay
// version mas nueva) con las URLs de la API metidas a fuego: /api/bleed y
// /api/bleed/init. HLTB las movio a /api/search/site (+ /init), las viejas
// devuelven 404, y el paquete no deja cambiarlas. Parchear node_modules no
// sobrevive a un npm install, asi que la unica salida estable es dejar de
// depender de el. Es lo mismo que hace la propia web de HLTB (verificado
// leyendo su bundle: mismas dos rutas, mismas tres cabeceras del token).
//
// Que HLTB rote otra vez es cuestion de tiempo -es una API no oficial-, y por
// eso el fallo se trata como "sin tiempos" (ver getHltbTimes) en vez de
// tumbar el alta: cuando vuelva a pasar, el sintoma sera este fichero, no un
// alta rota. Si eso ocurre, comprobar los dos endpoints de abajo contra el
// bundle de howlongtobeat.com (buscar "search/site" en _next/static/chunks).

const BASE_URL = 'https://howlongtobeat.com';
const SEARCH_URL = `${BASE_URL}/api/search/site`;
const INIT_URL = `${BASE_URL}/api/search/site/init`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// El token dura de sobra; una hora es lo que usaba el paquete y lo que la web
// asume. Se refresca solo al caducar o ante un 403 (ver search).
const TOKEN_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

// El token anti-bot que HLTB exige en cada busqueda: un token opaco mas un par
// clave/valor que ademas viaja DENTRO del cuerpo (con la clave como nombre de
// campo, de ahi que sea dinamico). Los tres salen del endpoint /init.
type SecurityToken = { token: string; hpKey: string; hpVal: string };

// La forma cruda que devuelve HLTB. Solo se declaran los campos que se usan;
// el resto (imagen, plataformas, resenas...) no se guarda. Todo opcional
// porque es un scraper: si HLTB renombra un campo, sale undefined y el juego
// se queda sin ese tramo, no revienta.
type RawGame = {
  game_id?: number;
  game_name?: string;
  comp_main?: number;
  comp_plus?: number;
  comp_100?: number;
  release_world?: number;
};

// La forma que consume el resto del modulo (la misma que validaba
// hltbGameSchema): tiempos en horas y con los nombres de las columnas.
export type HltbSearchGame = {
  id: string;
  name: string;
  releaseYear?: number;
  completionTimes: {
    main?: number;
    mainExtra?: number;
    completionist?: number;
  };
};

const secondsToHours = (seconds: number | undefined): number | undefined =>
  seconds && seconds > 0 ? Math.round(seconds / 3600) : undefined;

const transformGame = (raw: RawGame): HltbSearchGame => ({
  id: String(raw.game_id ?? ''),
  name: raw.game_name ?? '',
  releaseYear: raw.release_world || undefined,
  completionTimes: {
    main: secondsToHours(raw.comp_main),
    mainExtra: secondsToHours(raw.comp_plus),
    completionist: secondsToHours(raw.comp_100),
  },
});

export class HLTBClient {
  private token: SecurityToken | null = null;
  private tokenExpiry = 0;
  // Deduplica refrescos concurrentes: dos altas a la vez piden un token cada
  // una y bastaba con uno. Mismo patron que getValidToken de IGDB.
  private tokenRefresh: Promise<SecurityToken> | null = null;
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'User-Agent': USER_AGENT,
        // HLTB rechaza (403) las peticiones sin Referer/Origin de su propio
        // dominio: es justo el filtro anti-bot que el token complementa.
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
      },
    });
  }

  private async getToken(): Promise<SecurityToken> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    if (this.tokenRefresh) return this.tokenRefresh;

    this.tokenRefresh = this.refreshToken();
    try {
      return await this.tokenRefresh;
    } finally {
      this.tokenRefresh = null;
    }
  }

  private async refreshToken(): Promise<SecurityToken> {
    // El ?t= es un cache-buster que la web tambien manda: sin el, un
    // intermediario podria servir un token ya caducado.
    const response = await this.http.get(`${INIT_URL}?t=${Date.now()}`);
    const { token, hpKey, hpVal } = (response.data ?? {}) as Partial<SecurityToken>;
    if (!token || !hpKey || !hpVal) {
      throw new Error('token de HowLongToBeat invalido o con forma inesperada');
    }
    this.token = { token, hpKey, hpVal };
    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return this.token;
  }

  private buildPayload(
    query: string,
    limit: number,
    token: SecurityToken,
  ): Record<string, unknown> {
    return {
      searchType: 'games',
      searchTerms: query.trim().split(/\s+/),
      searchPage: 1,
      size: Math.min(Math.max(1, limit), 100),
      searchOptions: {
        games: {
          userId: 0,
          platform: '',
          sortCategory: 'popular',
          rangeCategory: 'main',
          rangeTime: { min: null, max: null },
          gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
          rangeYear: { min: '', max: '' },
          modifier: '',
        },
        users: { sortCategory: 'postcount' },
        lists: { sortCategory: 'follows' },
        filter: '',
        sort: 0,
        randomizer: 0,
      },
      useCache: true,
      // El par del token va tambien en el cuerpo, con la clave como nombre de
      // campo. Es parte del esquema anti-bot: sin esto, 403.
      [token.hpKey]: token.hpVal,
    };
  }

  private async post(
    query: string,
    limit: number,
    token: SecurityToken,
  ): Promise<HltbSearchGame[]> {
    const response = await this.http.post(SEARCH_URL, this.buildPayload(query, limit, token), {
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'x-auth-token': token.token,
        'x-hp-key': token.hpKey,
        'x-hp-val': token.hpVal,
      },
    });
    const data = (response.data ?? {}) as { data?: unknown };
    if (!Array.isArray(data.data)) return [];
    return data.data.map((game) => transformGame(game as RawGame));
  }

  async search(query: string, options: { limit?: number } = {}): Promise<HltbSearchGame[]> {
    if (!query || typeof query !== 'string') {
      throw new Error('la busqueda de HowLongToBeat necesita un titulo');
    }
    const limit = options.limit ?? 20;

    try {
      return await this.post(query, limit, await this.getToken());
    } catch (error) {
      // Un token caducado antes de tiempo (rotacion en el lado de HLTB) sale
      // como 403: se tira el token y se reintenta UNA vez con uno fresco,
      // igual que hace la web. Cualquier otro fallo se propaga: getHltbTimes
      // ya lo convierte en "sin tiempos".
      if (error instanceof AxiosError && error.response?.status === 403) {
        this.token = null;
        this.tokenExpiry = 0;
        return this.post(query, limit, await this.getToken());
      }
      throw error;
    }
  }
}
