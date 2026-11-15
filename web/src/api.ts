import type {
  AchievementEntry,
  ActiveTimerDto,
  EventDatePrecision,
  GameAchievements,
  GameDetail,
  GameMedia,
  GameSession,
  IgdbSearchHit,
  IgdbSearchResult,
  IterationDetail,
  LibraryGame,
  PlanAddRequest,
  PlanAddResponse,
  PlanPinResponse,
  PlanReorderResponse,
  PlannedGame,
  SagaEntry,
  SessionPage,
  SessionWithGame,
  SourceCompletion,
  SpendEventRow,
  StateEventRow,
  StateType,
  StatsSummary,
  TimerBeatResponse,
  TimerResponse,
  TimerStopResponse,
} from '../../src/shared/api/v2';
import type { SyncErrorBody, SyncErrorCode } from '../../src/shared/sync/protocol';

// El contrato de la API se importa de src/shared/api/v2, que es de donde lo
// importa también el hub. Es una importación SOLO DE TIPOS: no entra nada de
// ahí en el bundle del navegador, pero si allí cambia un campo, aquí deja de
// compilar.
export type {
  AchievementEntry,
  ActiveTimerDto,
  EventDatePrecision,
  GameAchievements,
  GameDetail,
  GameMedia,
  GameSession,
  IgdbSearchResult,
  IterationDetail,
  LibraryGame,
  PlannedGame,
  SagaEntry,
  SessionPage,
  SessionWithGame,
  SourceCompletion,
  SpendEventRow,
  StateEventRow,
  StateType,
  StatsSummary,
  TimerStopResponse,
};

// Mismo origen siempre: en producción el hub sirve la PWA y la API juntas
// (hub/worker/wrangler.jsonc, `assets`), y en desarrollo el proxy de Vite hace
// lo propio. Nada de URLs base ni de variables de entorno con el dominio.
export const API_BASE = '/api/v2';

// Tope de espera por petición (§13.4). Un móvil con una cobertura a medias no
// falla: se queda esperando, y sin tope la pantalla sería un spinner eterno.
export const REQUEST_TIMEOUT_MS = 15_000;

export type ApiFailureCode = SyncErrorCode | 'session_expired' | 'timeout' | 'network';

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiFailureCode,
    message: string,
  ) {
    super(message);
  }
}

// Los textos de la interfaz están en inglés. Los mensajes del hub son notas en
// español, así que solo se enseñan los de los choques de una escritura
// (`conflict`, `invalid_request`, `not_found`), que dicen algo concreto que la
// persona puede entender: "ese juego se está jugando en PC-A".
const FIXED_MESSAGES: Partial<Record<ApiFailureCode, string>> = {
  session_expired: 'Your session has expired. Reload the page to sign in again.',
  timeout: 'Afterplay took too long to answer. Try again.',
  network: "Couldn't reach Afterplay. Check your connection.",
  unauthorized: 'Your session has expired. Reload the page to sign in again.',
  forbidden: "This account isn't linked to an Afterplay library.",
  igdb_not_configured: 'Open Afterplay on your PC once to enable search.',
  igdb_unavailable: "IGDB isn't responding. Try again later.",
  quota_exceeded: 'Afterplay is over its daily limit. Try again later.',
  rate_limited: 'Too many requests. Try again in a moment.',
  internal: 'Afterplay had a problem. Try again.',
};

const SERVER_MESSAGE_CODES: ReadonlySet<ApiFailureCode> = new Set([
  'conflict',
  'invalid_request',
  'not_found',
]);

const sessionExpired = (): ApiFailure =>
  new ApiFailure('session_expired', FIXED_MESSAGES.session_expired as string);

const failureFromBody = (status: number, body: unknown): ApiFailure => {
  const parsed = body as Partial<SyncErrorBody> | null;
  const code = typeof parsed?.error === 'string' ? (parsed.error as SyncErrorCode) : null;
  if (code === 'unauthorized') return sessionExpired();
  if (code === null) return new ApiFailure('internal', FIXED_MESSAGES.internal as string);
  const server = typeof parsed?.message === 'string' ? parsed.message : '';
  const message =
    SERVER_MESSAGE_CODES.has(code) && server !== ''
      ? server
      : (FIXED_MESSAGES[code] ?? `Afterplay answered with an error (${status}).`);
  return new ApiFailure(code, message);
};

const isJson = (response: Response): boolean =>
  /json/i.test(response.headers.get('content-type') ?? '');

// Una petición a la API. `redirect: 'manual'` es lo que permite RECONOCER la
// sesión de Access caducada: Access contesta con una redirección a su página de
// entrada, y el navegador, al seguirla a otro origen, solo daría un "Network
// Error" idéntico a estar sin cobertura. Con 'manual' la redirección llega como
// una respuesta `opaqueredirect`. Si en su lugar llega HTML (la página de
// entrada) o un 401/403 sin cuerpo JSON, es lo mismo.
const send = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new ApiFailure('timeout', FIXED_MESSAGES.timeout as string);
    }
    throw new ApiFailure('network', FIXED_MESSAGES.network as string);
  }

  try {
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw sessionExpired();
    }
    if (!isJson(response)) {
      if (response.ok || response.status === 401 || response.status === 403) {
        throw sessionExpired();
      }
      throw new ApiFailure('internal', FIXED_MESSAGES.internal as string);
    }
    let parsed: unknown;
    try {
      // El cuerpo también cuenta para el tope: una respuesta que empieza y no
      // termina tiene que acabar en 'timeout', no colgar la pantalla.
      parsed = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new ApiFailure('timeout', FIXED_MESSAGES.timeout as string);
      }
      throw new ApiFailure('internal', FIXED_MESSAGES.internal as string);
    }
    if (!response.ok) throw failureFromBody(response.status, parsed);
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
};

const get = <T>(path: string): Promise<T> => send<T>('GET', path);
const post = <T>(path: string, body: unknown): Promise<T> => send<T>('POST', path, body);

const id = (value: string): string => encodeURIComponent(value);

// La zona horaria del NAVEGADOR: las estadísticas "de este año" y "de hoy"
// dependen de dónde esté la persona, y el hub no puede adivinarlo.
const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ── Lecturas ───────────────────────────────────────────────────────────────

export const fetchLibrary = (): Promise<LibraryGame[]> => get<LibraryGame[]>('/library');

export const fetchStats = (): Promise<StatsSummary> =>
  get<StatsSummary>(`/stats/summary?tz=${encodeURIComponent(browserTimeZone())}`);

export const fetchPlan = (): Promise<PlannedGame[]> => get<PlannedGame[]>('/plan');

export const fetchGame = (gameId: string): Promise<GameDetail> =>
  get<GameDetail>(`/games/${id(gameId)}`);

// Paginadas en el servidor: la respuesta trae la página y el total, para poder
// pintar "Page 2 of 7" sin traerse las siete.
export const fetchSessions = (limit = 20, offset = 0): Promise<SessionPage> =>
  get<SessionPage>(`/sessions?limit=${limit}&offset=${offset}`);

// Los sub-recursos de la ficha van APARTE de ella a propósito: los logros son
// una lista larga (un juego puede tener 200) y la saga y las capturas salen de
// IGDB, o sea que dependen de una red ajena. Metidos dentro de /games/:id
// harían que la ficha entera tardara lo que tarde lo más lento, o fallara con
// ello.
export const fetchAchievements = (gameId: string): Promise<GameAchievements> =>
  get<GameAchievements>(`/games/${id(gameId)}/achievements`);

export const fetchCuriosities = (gameId: string): Promise<string[]> =>
  get<string[]>(`/games/${id(gameId)}/curiosities`);

// ── IGDB ───────────────────────────────────────────────────────────────────

// La búsqueda la hace el HUB contra IGDB con las claves que sube el PC (§9.3),
// nunca este navegador: son secretos, y meterlos en el bundle sería publicarlos.
export const searchGames = (query: string): Promise<IgdbSearchResult[]> =>
  get<IgdbSearchResult[]>(`/search?q=${encodeURIComponent(query)}`);

export const fetchSaga = (gameId: string): Promise<SagaEntry[]> =>
  get<SagaEntry[]>(`/games/${id(gameId)}/saga`);

export const fetchMedia = (gameId: string): Promise<GameMedia> =>
  get<GameMedia>(`/games/${id(gameId)}/media`);

// ── Plan ───────────────────────────────────────────────────────────────────

// Escrituras inmediatas: ya no hay buzón ni "pendiente" (§13.3). Cuando la
// promesa se resuelve, el cambio está hecho.
export const pinGame = (gameId: string): Promise<PlanPinResponse> =>
  post<PlanPinResponse>('/plan/pin', { gameId });

export const unpinGame = (gameId: string): Promise<PlanPinResponse> =>
  post<PlanPinResponse>('/plan/unpin', { gameId });

export const reorderPlan = (orderedIds: readonly string[]): Promise<PlanReorderResponse> =>
  post<PlanReorderResponse>('/plan/reorder', { orderedIds });

export const addToPlan = (game: IgdbSearchHit): Promise<PlanAddResponse> =>
  post<PlanAddResponse>('/plan/add', {
    igdbId: game.igdbId,
    title: game.title,
    coverUrl: game.coverUrl,
    releaseYear: game.releaseYear,
  } satisfies PlanAddRequest);

// ── El cronómetro ──────────────────────────────────────────────────────────

export const fetchActiveTimer = (): Promise<TimerResponse> => get<TimerResponse>('/timer');

export const startTimer = (gameId: string): Promise<ActiveTimerDto> =>
  post<ActiveTimerDto>('/timer/start', { gameId });

export const stopTimer = (sessionId: string): Promise<TimerStopResponse> =>
  post<TimerStopResponse>('/timer/stop', { sessionId });

// El latido. Devuelve si la sesión sigue viva: si el hub la cerró por llevar
// horas muda, esto viene a false y la pantalla se entera sola.
export const beatTimer = (sessionId: string): Promise<TimerBeatResponse> =>
  post<TimerBeatResponse>('/timer/beat', { sessionId });

// El último latido antes de que la pestaña se vaya al fondo (bloquear el
// móvil, cambiar de app). Con `keepalive`: una petición normal lanzada mientras
// la página se congela se cancela a medias, y esta es justo la que deja escrito
// "seguía vivo a esta hora". Sin tope ni lectura de la respuesta: no hay
// pantalla que la lea.
export const beatTimerOnHide = (sessionId: string): void => {
  void fetch(`${API_BASE}/timer/beat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    keepalive: true,
    credentials: 'same-origin',
    redirect: 'manual',
  }).catch(() => {
    // Perderlo no es nada: queda el latido anterior.
  });
};
