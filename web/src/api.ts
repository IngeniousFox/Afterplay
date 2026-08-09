import axios from 'axios';
import type {
  AchievementEntry,
  ActiveTimer,
  ApiError,
  MailboxFailure,
  PendingEntry,
  PlanMailboxEntry,
  PlanPending,
  SearchResult,
  EventDatePrecision,
  GameAchievements,
  GameDetail,
  GameMedia,
  GameSession,
  IterationDetail,
  LibraryGame,
  PlannedGame,
  SagaEntry,
  SessionPage,
  SessionWithGame,
  SpendEventRow,
  StateEventRow,
  StatsSummary,
  StateType,
} from '../../worker/src/api-types';

// El contrato de la API se importa del Worker, que es quien lo define. Es una
// importación SOLO DE TIPOS: no entra nada del Worker en el bundle del
// navegador, pero si allí cambia un campo, aquí deja de compilar. Esa es toda
// la gracia de tener las dos mitades en el mismo repo.
export type {
  AchievementEntry,
  ActiveTimer,
  EventDatePrecision,
  MailboxFailure,
  PendingEntry,
  PlanMailboxEntry,
  PlanPending,
  SearchResult,
  GameAchievements,
  GameDetail,
  GameMedia,
  GameSession,
  IterationDetail,
  LibraryGame,
  PlannedGame,
  SagaEntry,
  SessionPage,
  SessionWithGame,
  SpendEventRow,
  StateEventRow,
  StatsSummary,
  StateType,
};

// Mismo origen siempre: en producción el Worker sirve la PWA y la API juntas,
// y en desarrollo el proxy de Vite hace lo propio. Nada de URLs base ni de
// variables de entorno con el dominio.
const client = axios.create({ baseURL: '/api' });

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError['error']['code'],
    message: string,
  ) {
    super(message);
  }
}

// Traduce el error del Worker a algo que la interfaz pueda tratar por su
// `code` en vez de leyendo el texto. Importa sobre todo por 'schema_outdated'
// (§5.4): ese caso no es un fallo de la web, es que el escritorio de esa
// persona todavía no se ha actualizado, y la pantalla lo dice con esas
// palabras en vez de enseñar un error genérico.
const request = async <T>(path: string): Promise<T> => {
  try {
    const { data } = await client.get<T>(path);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      const body = error.response.data as Partial<ApiError>;
      if (body.error?.code) throw new ApiFailure(body.error.code, body.error.message);
    }
    throw new ApiFailure('upstream_unavailable', 'No se pudo conectar con Afterplay.');
  }
};

export const fetchLibrary = (): Promise<LibraryGame[]> => request<LibraryGame[]>('/library');

export const fetchStats = (): Promise<StatsSummary> => request<StatsSummary>('/stats/summary');

export const fetchPlan = (): Promise<PlannedGame[]> => request<PlannedGame[]>('/plan');

export const fetchGame = (id: number): Promise<GameDetail> => request<GameDetail>(`/games/${id}`);

// Paginadas en el servidor: la respuesta trae la página y el total, para poder
// pintar "Page 2 of 7" sin traerse las siete.
export const fetchSessions = (limit = 20, offset = 0): Promise<SessionPage> =>
  request<SessionPage>(`/sessions?limit=${limit}&offset=${offset}`);

// Los sub-recursos de la ficha van APARTE de ella a propósito: los logros son
// una lista larga (un juego puede tener 200) y la saga y las capturas salen de
// IGDB, o sea que dependen de una red ajena. Metidos dentro de /api/games/:id
// harían que la ficha entera tardara lo que tarde lo más lento — o fallara
// con ello.
export const fetchAchievements = (id: number): Promise<GameAchievements> =>
  request<GameAchievements>(`/games/${id}/achievements`);

export const fetchCuriosities = (id: number): Promise<string[]> =>
  request<string[]>(`/games/${id}/curiosities`);

export const fetchSaga = (id: number): Promise<SagaEntry[]> =>
  request<SagaEntry[]>(`/games/${id}/saga`);

export const fetchMedia = (id: number): Promise<GameMedia> =>
  request<GameMedia>(`/games/${id}/media`);

// ── El buzón (REMOTO.md §6) ────────────────────────────────────────────────

// La búsqueda la hace el WORKER contra IGDB con las claves del inquilino,
// nunca este navegador (§6.4): son secretos, y meterlos en el bundle sería
// publicarlos.
export const searchGames = (query: string): Promise<SearchResult[]> =>
  request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`);

export const fetchPlanPending = (): Promise<PlanPending> => request<PlanPending>('/plan/pending');

const post = async (path: string, body?: unknown): Promise<void> => {
  try {
    await client.post(path, body);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      const failure = error.response.data as Partial<ApiError>;
      if (failure.error?.code) throw new ApiFailure(failure.error.code, failure.error.message);
    }
    throw new ApiFailure('upstream_unavailable', 'No se pudo guardar el cambio.');
  }
};

// La ÚNICA escritura de la app sobre datos. No toca las tablas reales: deja
// una orden que el escritorio aplica al arrancar llamando al código de verdad.
export const enqueuePlan = (entry: PlanMailboxEntry): Promise<void> => post('/plan/enqueue', entry);

// Quitar de en medio un fallo ya drenado. No reencola nada: solo borra su
// mensaje para que deje de ocupar sitio.
export const dismissPlanFailure = (id: number): Promise<void> => post(`/plan/dismiss?id=${id}`);

// ── El cronómetro (REMOTO.md §7) ───────────────────────────────────────────

export const fetchActiveTimer = (): Promise<ActiveTimer | null> =>
  request<ActiveTimer | null>('/timer');

const postJson = async <T>(path: string): Promise<T> => {
  try {
    const { data } = await client.post<T>(path);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      const failure = error.response.data as Partial<ApiError>;
      if (failure.error?.code) throw new ApiFailure(failure.error.code, failure.error.message);
    }
    throw new ApiFailure('upstream_unavailable', 'No se pudo hablar con Afterplay.');
  }
};

export const startTimer = (gameId: number): Promise<ActiveTimer> =>
  postJson<ActiveTimer>(`/timer/start?gameId=${gameId}`);

export const stopTimer = (sessionId: number): Promise<{ durationSec: number }> =>
  postJson<{ durationSec: number }>(`/timer/stop?sessionId=${sessionId}`);

// El latido. Devuelve si la sesión sigue viva: si el escritorio la cerró por
// llevar horas muda, esto viene a false y la pantalla se entera sola.
export const beatTimer = (sessionId: number): Promise<{ alive: boolean }> =>
  postJson<{ alive: boolean }>(`/timer/beat?sessionId=${sessionId}`);
