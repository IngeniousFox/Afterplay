// Tipos de la API v2 de la PWA. Lecturas: biblioteca, plan, ficha, logros, curiosidades, sesiones y
// estadísticas (§13.2). Ninguno lleva rutas locales de un PC (F-31): ni `executablePath`, ni
// `installDirectory`, ni el tamaño de la instalación; de las instalaciones solo "en qué dispositivos".
//
// Es el contrato de la 1.x (`worker/src/api-types.ts`) con los ids de texto de la 2.0. Las fechas
// viajan como epoch en milisegundos (número): un `JSON.parse` no reconstruye un `Date`, y un número
// no se presta a confundir lo que tienes en la mano. Los ids son texto, nunca números.

export type StateType =
  'started' | 'completed' | 'dropped' | 'on_hold' | 'resting' | 'plan_to_play';
export type DatePrecision = 'year' | 'month' | 'day';
export type EventDatePrecision = DatePrecision | 'datetime';
/** El papeleo del alta (sin fecha) lleva 'unknown' (R-07). */
export type StateEventPrecision = EventDatePrecision | 'unknown';
export type SpendType = 'purchase' | 'ingame_spend';
export type AchievementSource = 'steam' | 'emu' | 'ra';

// ── Biblioteca ─────────────────────────────────────────────────────────────

/**
 * La lista de la biblioteca va DELIBERADAMENTE ligera (§3.1): se pide una vez y
 * se busca entera en el cliente, así que cada campo se multiplica por el número
 * de juegos. Lo pesado vive en la ficha.
 */
export type LibraryGame = {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  totalHours: number;
  sessionCount: number;
  currentState: StateType | null;
  lastPlayedAt: number | null;
  isLive: boolean;
  liveSince: number | null;
  /** El dispositivo de la sesión abierta (§10.8, "Jugando en PC-A"); null sin sesión en vivo. */
  liveDeviceId: string | null;
};

// ── Plan ───────────────────────────────────────────────────────────────────

/** Un juego del Plan. No lleva horas ni estado: un planeado es intención. */
export type PlannedGame = {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  releaseDate: number | null;
  releaseDatePrecision: DatePrecision | null;
  genres: string[] | null;
  hltbMain: number | null;
  /** Un endless no cuenta para la deuda del Plan: no tiene final que alcanzar. */
  endless: boolean;
  /** Desde cuándo espera en el Plan. */
  addedAt: number;
  /** El "Up next": lo fijado arriba de la cola. */
  pinnedAt: number | null;
  /** Por qué se planeó. */
  planNote: string | null;
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  steamPositive: number | null;
  steamNegative: number | null;
};

// ── Ficha ──────────────────────────────────────────────────────────────────

export type GameSession = {
  id: string;
  iterationId: string | null;
  emulatorId: string | null;
  isManual: boolean;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  datePrecision: EventDatePrecision;
  note: string | null;
  /** El dispositivo dueño de la sesión (`devices.id`). */
  deviceId: string;
  startedBy: 'watcher' | 'timer' | 'play';
};

export type StateEventRow = {
  id: string;
  iterationId: string;
  type: StateType;
  occurredAt: number;
  datePrecision: StateEventPrecision;
  note: string | null;
};

export type SpendEventRow = {
  id: string;
  type: SpendType;
  amount: number;
  occurredAt: number;
  datePrecision: EventDatePrecision;
  note: string | null;
};

/** El evento del que sale una fecha derivada, con su precisión para poder formatearla. */
export type DerivedEvent = {
  id: string;
  occurredAt: number;
  datePrecision: StateEventPrecision;
};

/** Un playthrough con lo que el escritorio deriva de él. Nada de esto está almacenado. */
export type IterationDetail = {
  id: string;
  label: string;
  playedPlatform: string;
  origin: string;
  format: 'digital' | 'physical' | null;
  manualTotalPlayed: number | null;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  extraContent: boolean;
  hours: number;
  startedAt: number | null;
  endedAt: number | null;
  startEvent: DerivedEvent | null;
  endEvent: DerivedEvent | null;
  /** El inicio lo marcó una sesión real (instante exacto) y no un evento tecleado. */
  startedBySession: boolean;
  currentState: StateType | null;
  sessions: GameSession[];
  spend: number;
};

/** "Instalado en": el dispositivo, nunca su ruta (F-31). */
export type InstalledOnDevice = {
  deviceId: string;
  deviceName: string;
};

/** El paso por el Plan (R-06): los dos hitos derivados, de solo lectura. */
export type PlanHistory = {
  plannedAt: number;
  note: string | null;
  /** Cuándo salió del Plan; null mientras siga en él. */
  leftAt: number | null;
};

export type GameDetail = {
  id: string;
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  igdbId: number | null;
  steamAppId: number | null;

  releaseYear: number | null;
  releaseDate: number | null;
  releaseDatePrecision: DatePrecision | null;
  genres: string[] | null;
  officialPlatforms: string[] | null;
  developer: string | null;
  publisher: string | null;
  summary: string | null;
  igdbCollections: { id: number; name: string }[] | null;

  isEmulated: boolean;
  endless: boolean;
  planned: boolean;
  addedAt: number;
  planPinnedAt: number | null;
  planHistory: PlanHistory | null;
  notes: string | null;
  /** En qué dispositivos está instalado (sin rutas). */
  installedOn: InstalledOnDevice[];

  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;

  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  steamTags: { name: string; votes: number }[] | null;
  steamPositive: number | null;
  steamNegative: number | null;

  // Derivados.
  totalHours: number;
  currentState: StateType | null;
  isLive: boolean;
  /** Inicio de la sesión abierta más reciente, si la hay. */
  liveSince: number | null;
  totalSpend: number;
  costPerHour: number | null;
  iterations: IterationDetail[];
  stateHistory: StateEventRow[];
  spendHistory: SpendEventRow[];
};

// ── Logros ─────────────────────────────────────────────────────────────────

export type AchievementEntry = {
  id: string;
  apiName: string;
  displayName: string;
  /** Null en los ocultos que aún no has desbloqueado. */
  description: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
  hidden: boolean;
  /** % global de jugadores que lo tienen: la rareza real. */
  globalPercent: number | null;
  unlockedAt: number | null;
  /** Falso cuando la fecha es la del rescate y no la de la hazaña. */
  dateReliable: boolean;
  sources: AchievementSource[];
};

/** "¿Completado?" de UNA fuente (R-11): un 100 % de Steam y uno de RA no se suman. */
export type SourceCompletion = {
  source: 'steam' | 'ra';
  total: number;
  unlocked: number;
  complete: boolean;
  known: boolean;
  completedAt: number | null;
};

export type GameAchievements = {
  gameId: string;
  steamAppId: number | null;
  syncedAt: number | null;
  unlocksSyncedAt: number | null;
  entries: AchievementEntry[];
  completion: SourceCompletion[];
};

// ── Sesiones ───────────────────────────────────────────────────────────────

export type SessionWithGame = {
  id: string;
  iterationId: string;
  gameId: string;
  gameTitle: string;
  coverUrl: string | null;
  isManual: boolean;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  datePrecision: EventDatePrecision;
  note: string | null;
  deviceId: string;
};

/** Una página de sesiones; `total` viaja con ella para pintar "Page 2 of 7". */
export type SessionPage = {
  sessions: SessionWithGame[];
  total: number;
  limit: number;
  offset: number;
};

// ── Estadísticas ───────────────────────────────────────────────────────────

/** Las horas del año con la regla de Stats del escritorio: sesiones del año más manuales de él. */
export type StatsSummary = {
  totalGames: number;
  playedGames: number;
  totalHours: number;
  totalSessions: number;
  hoursThisYear: number;
  gamesThisYear: number;
  year: number;
  /** Los cinco estados más "sin estado": la suma es exactamente `totalGames`. */
  beaten: number;
  playing: number;
  dropped: number;
  onHold: number;
  resting: number;
  unplayed: number;
  /** La sesión abierta ahora mismo, si la hay. */
  live: { gameId: string; gameTitle: string; coverUrl: string | null; since: number } | null;
};

/** Tope y valor por defecto de `GET /sessions?limit`. */
export const SESSIONS_PAGE_DEFAULT = 20;
export const SESSIONS_PAGE_MAX = 100;
