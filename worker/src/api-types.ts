// El contrato de la API, y la única cosa que la PWA importa del Worker.
//
// Las fechas viajan como epoch en milisegundos (número), no como ISO ni como
// Date. Un JSON.parse no reconstruye un Date, así que mandar ISO obliga a
// recordar en cada campo si lo que tienes en la mano ya es Date o todavía es
// texto — y ese despiste sale como "Invalid Date" en pantalla. Un número no
// se presta a la confusión: o lo conviertes, o no compila.

export type StateType =
  'started' | 'completed' | 'dropped' | 'on_hold' | 'resting' | 'plan_to_play';
export type DatePrecision = 'year' | 'month' | 'day';
export type EventDatePrecision = DatePrecision | 'datetime';
export type SpendType = 'purchase' | 'ingame_spend';

// La lista de la biblioteca va DELIBERADAMENTE ligera (§3.1: móvil primero,
// sin perseguir la paridad). Es un payload que se pide una vez y se busca
// entero en el cliente, así que cada campo que se añada aquí se multiplica por
// el número de juegos. Lo pesado vive en la ficha, que se pide de una en una.
export type LibraryGame = {
  id: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  totalHours: number;
  sessionCount: number;
  currentState: StateType | null;
  lastPlayedAt: number | null;
  isLive: boolean;
  liveSince: number | null;
};

export type GameSession = {
  id: number;
  iterationId: number | null;
  emulatorId: number | null;
  isManual: boolean;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  datePrecision: EventDatePrecision;
  note: string | null;
};

export type StateEventRow = {
  id: number;
  iterationId: number;
  type: StateType;
  occurredAt: number;
  datePrecision: EventDatePrecision;
  note: string | null;
};

export type SpendEventRow = {
  id: number;
  type: SpendType;
  amount: number;
  occurredAt: number;
  datePrecision: EventDatePrecision;
  note: string | null;
};

// El evento del que sale una fecha DERIVADA del playthrough. Viaja con su
// precisión porque sin ella no se puede formatear: un inicio con precisión de
// año se escribe "2023", no "1 de enero de 2023 a las 00:00".
export type DerivedEvent = {
  id: number;
  occurredAt: number;
  datePrecision: EventDatePrecision;
};

// Un playthrough con todo lo que el escritorio deriva de él (SPEC 4.4). Nada
// de esto está almacenado: sale del log de eventos y de las sesiones.
export type IterationDetail = {
  id: number;
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
  // Si el inicio lo marcó una sesión real (instante exacto) o un evento
  // tecleado a mano (que lleva su propia precisión).
  startedBySession: boolean;
  currentState: StateType | null;
  sessions: GameSession[];
  spend: number;
};

export type GameDetail = {
  id: number;
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

  installDirectory: string | null;
  installSizeBytes: number | null;
  executablePath: string | null;
  isEmulated: boolean;
  endless: boolean;
  planned: boolean;
  addedAt: number;
  notes: string | null;

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

  // Derivados (SPEC 4.4).
  totalHours: number;
  currentState: StateType | null;
  isLive: boolean;
  liveSince: number | null;
  totalSpend: number;
  costPerHour: number | null;
  iterations: IterationDetail[];
  stateHistory: StateEventRow[];
  spendHistory: SpendEventRow[];
};

export type SessionWithGame = {
  id: number;
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  note: string | null;
};

// Una página de sesiones. `total` viaja con ella porque la pantalla lo
// necesita para pintar "Page 2 of 7" sin traerse las siete páginas.
export type SessionPage = {
  sessions: SessionWithGame[];
  total: number;
  limit: number;
  offset: number;
};

export type StatsSummary = {
  totalGames: number;
  playedGames: number;
  totalHours: number;
  totalSessions: number;
  // Las horas del año en curso con la MISMA regla que la pantalla de Stats
  // del escritorio filtrada por año: sesiones de ese año MÁS las horas
  // manuales atribuidas a él. No solo sesiones.
  hoursThisYear: number;
  gamesThisYear: number;
  year: number;
  // Reparto por estado actual, para la fila de cifras de la portada. Están los
  // CINCO estados más el "sin estado", así que la suma es exactamente
  // totalGames: la portada los tenía que deducir por resta (todo lo que no era
  // beaten/playing/dropped/unplayed caía en un tramo "On Hold + Resting" a
  // ojo), y una resta no sabe partir ese tramo en dos.
  beaten: number;
  playing: number;
  dropped: number;
  onHold: number;
  resting: number;
  unplayed: number;
  // La sesión abierta ahora mismo, si la hay: es lo que hace que la portada
  // valga la pena mirar desde el sofá (§2.1 — una fila con endedAt a null se
  // ve desde fuera sin que el PC esté encendido).
  live: { gameId: number; gameTitle: string; coverUrl: string | null; since: number } | null;
};

// Un juego del Plan. No lleva horas ni estado: un planeado es intención, no
// historial. `pinnedAt` es el "Up next" — lo que has fijado arriba de la cola.
export type PlannedGame = {
  id: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  releaseDate: number | null;
  releaseDatePrecision: DatePrecision | null;
  genres: string[] | null;
  hltbMain: number | null;
  // Un endless no cuenta para la deuda del Plan: no tiene final que alcanzar.
  endless: boolean;
  addedAt: number;
  pinnedAt: number | null;
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  steamPositive: number | null;
  steamNegative: number | null;
};

// ── El cronómetro (REMOTO.md §7) ──────────────────────────────────────────
// La sesión de cronómetro abierta ahora mismo. Es una sesión NORMAL: lo que
// la distingue es solo quién apretó el botón.
export type ActiveTimer = {
  sessionId: number;
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
  startedAt: number;
  lastHeartbeatAt: number | null;
};

// ── El buzón del Plan (REMOTO.md §6) ──────────────────────────────────────
// Los tipos de las órdenes viven en shared/planMailbox.ts, que es el contrato
// que comparten los TRES lados (Worker, escritorio y PWA). Se reexportan aquí
// para que la web los reciba por el mismo sitio que todo lo demás.
export type {
  MailboxGameSource,
  PlanMailboxEntry,
  PlanMailboxType,
} from '../../src/shared/planMailbox';

export type SearchResult = {
  // De dónde sale, igual que el `source` del alta del escritorio: o el juego
  // viene de IGDB (lo normal) o de la tienda de Steam (los que IGDB todavía no
  // tiene). Nunca los dos, y a partir de aquí nadie vuelve a preguntárselo.
  source: import('../../src/shared/planMailbox').MailboxGameSource;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  // Dónde lo tienes ya, si lo tienes: en la biblioteca, en el plan, o encolado
  // y aún sin drenar. Sin esto, el buscador ofrece añadir algo que va a
  // reventar contra el UNIQUE al aplicarse — en otra máquina y sin nadie
  // delante.
  owned: 'library' | 'plan' | 'queued' | null;
};

export type PendingEntry = {
  id: number;
  createdAt: number;
  entry: import('../../src/shared/planMailbox').PlanMailboxEntry;
};

export type MailboxFailure = {
  id: number;
  entry: import('../../src/shared/planMailbox').PlanMailboxEntry;
  error: string;
};

export type PlanPending = {
  pending: PendingEntry[];
  failures: MailboxFailure[];
};

// ── Logros (LOGROS.md) ─────────────────────────────────────────────────────
export type AchievementSource = 'steam' | 'emu' | 'ra';

export type AchievementEntry = {
  id: number;
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
  hidden: boolean;
  // Porcentaje global de jugadores que lo tienen: la rareza real medida por
  // Steam. Es lo que separa "lo tiene todo el mundo" de "esto lo tiene el 2%".
  globalPercent: number | null;
  unlockedAt: number | null;
  // Falso cuando la fecha es la del rescate y no la de la hazaña (el caso del
  // emulador que sella de golpe logros viejos). Sigue siendo cierto que lo
  // tienes; lo que no se sabe es cuándo.
  dateReliable: boolean;
  sources: AchievementSource[];
};

export type GameAchievements = {
  gameId: number;
  steamAppId: number | null;
  syncedAt: number | null;
  unlocksSyncedAt: number | null;
  entries: AchievementEntry[];
};

// Un juego de la misma saga. Los que están en tu biblioteca traen `libraryId`
// y su estado; los que no, viajan solo con lo que dice IGDB.
export type SagaEntry = {
  igdbId: number;
  libraryId: number | null;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  currentState: StateType | null;
  totalHours: number;
  planned: boolean;
};

export type GameMedia = {
  screenshots: string[];
  // La URL de YouTube del trailer, si IGDB tiene uno.
  videoId: string | null;
};

export type ApiError = {
  error: {
    code:
      | 'unauthenticated'
      | 'forbidden'
      | 'not_found'
      | 'schema_outdated'
      | 'upstream_unavailable'
      | 'internal';
    message: string;
  };
};
