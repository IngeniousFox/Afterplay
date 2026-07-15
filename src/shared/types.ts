import type {
  GameRow,
  Iteration,
  NewGame,
  NewIteration,
  NewSession,
  NewSpendEvent,
  NewStateEvent,
  Session,
  SpendEvent,
  StateEvent,
} from '../main/db/schema';

export type {
  GameRow,
  Iteration,
  NewGame,
  NewIteration,
  NewSession,
  NewSpendEvent,
  NewStateEvent,
  Session,
  SpendEvent,
  StateEvent,
} from '../main/db/schema';

// Inputs de los handlers de escritura. Parten de las formas de INSERT de
// Drizzle pero quitando lo que el renderer nunca debe mandar (ids, campos
// que fija el main) — así el contrato del IPC queda explícito aquí.
export type CreateGameInput = Omit<NewGame, 'id'>;

export type UpdateGamePatch = Partial<Omit<NewGame, 'id' | 'addedAt'>>;

export type CreateIterationInput = Omit<
  NewIteration,
  'id' | 'label' | 'startSessionId' | 'endSessionId'
> & { label?: string | null };

export type UpdateIterationPatch = Partial<
  Pick<
    NewIteration,
    | 'label'
    | 'playedPlatform'
    | 'origin'
    | 'format'
    | 'manualTotalPlayed'
    | 'extraContent'
    | 'rating'
  >
>;

export type AddManualSessionInput = Omit<NewSession, 'id' | 'isManual'> & {
  anchorAs?: 'start' | 'end';
};

export type AddStateEventInput = Omit<NewStateEvent, 'id'>;

export type AddSpendEventInput = Omit<NewSpendEvent, 'id'>;

// Input del guardado atómico del modal de añadir juego (Bloque 2F). Va en
// una sola llamada porque el main resuelve TODO lo que hace falta de fuera
// (detalle de IGDB, tiempos de HLTB, id de SteamGridDB) y escribe game +
// iteration + sesiones de borde + spendEvent + stateEvent inicial dentro de
// una única transacción — así no puede quedar un juego "a medias" si algo
// falla a mitad de camino.
export type CreateGameWithDetailsInput = {
  igdbId: number;
  endless: boolean;
  iteration: {
    playedPlatform: string;
    origin: string;
    format: 'digital' | 'physical';
  };
  hoursPlayed: number | null;
  // Estructurado desde el picker de fecha+precisión del renderer — ya no hay
  // texto libre que adivinar en el main. Solo tiene sentido si endless es
  // false (el modal oculta estos dos campos para juegos endless).
  started: { date: Date; precision: 'year' | 'month' | 'day' } | null;
  finished: { date: Date; precision: 'year' | 'month' | 'day' } | null;
  // Vocabulario de la DB (StateEvent['type']), no el de la UI — el renderer
  // ya traduce la opción elegida en el dropdown antes de mandarla. null =
  // sin estado inicial (juego normal que se añade como Unplayed).
  initialStatus: StateEvent['type'] | null;
  note: string | null;
  // Notas generales del juego — independientes del note de arriba (que
  // cuelga del stateEvent inicial). Un desplegable propio en el modal, no
  // atado a si se marcó "jugado antes" ni a si hay estado inicial.
  gameNotes: string | null;
  moneySpent: number | null;
  executablePath: string | null;
  // Elegidos a mano en el CoverPicker (SPEC 4.6) — null significa "sin
  // elección propia", el main usa su propio default (detail.covers[0]/
  // heroes[0], la primera candidata de IGDB) igual que hacía antes de que
  // existiera el picker.
  coverUrl: string | null;
  heroUrl: string | null;
  // Carpeta de instalación + su tamaño ya calculado (ver dialog:pickDirectory)
  // — null si no se eligió ninguna al añadir el juego.
  installDirectory: string | null;
  installSizeBytes: number | null;
};

// Sección Plan to Play — alta reducida: un juego planeado no tiene
// playthrough real todavía (ni plataforma, ni gasto, ni exe), solo el juego
// del catálogo + tus notas + la nota del historial ("por qué lo planeo").
export type CreatePlannedGameInput = {
  igdbId: number;
  note: string | null;
  gameNotes: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
};

// Pasar un juego planeado a la biblioteca de verdad: mismos datos que el
// alta normal (el modal de Add Game se abre prellenado) pero sobre el juego
// YA existente — nada de borrar y recrear, el historial (incluida la
// entrada de "Plan to Play") se conserva.
export type PromotePlannedGameInput = Omit<CreateGameWithDetailsInput, 'igdbId'> & {
  gameId: number;
};

// Resultado del picker de carpeta (Install directory, Add/Edit game) — el
// tamaño ya viene calculado desde el main, no hace falta un segundo viaje.
export type DirectoryPickResult = { path: string; sizeBytes: number };

// Botón Play — lanzar el .exe configurado (games:launchExecutable). 'missing'
// cuando la ruta guardada ya no existe (se movió/desinstaló el juego desde
// que se guardó); 'error' para cualquier otro fallo al abrirlo (shell.openPath
// devuelve un mensaje descriptivo, ej. permisos).
export type LaunchExecutableResult =
  { ok: true } | { ok: false; reason: 'missing' } | { ok: false; reason: 'error'; message: string };

export type { IgdbGameDetail, IgdbSearchResult } from '../main/igdb/types';

export type { HltbTimes } from '../main/hltb/types';

// SteamGridDB (Bloque 2C-ter) — igual, la fuente es main/sgdb/types.ts.
export type { GetSgdbImagesInput, SgdbImageCandidate, SgdbImages } from '../main/sgdb/types';

// Caché local de imágenes (Bloque 2C-quater) — la fuente es main/images/cache.ts.
export type { ImageCacheType } from '../main/images/cache';

export type GameListItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  // Solo para el Genre Radar (Bloque 5E) — se usa genres[0] como género
  // "principal" del juego, igual que officialPlatforms?.[0] en otros sitios.
  genres: string[] | null;
  // Para el donut de "edad" de los juegos jugados (estilo resumen anual de
  // Steam): nuevos vs 1-5 / 5-10 / 10+ años respecto al año filtrado.
  releaseYear: number | null;
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
  // startedAt de la sesión abierta, para el contador en vivo de la card
  // (SPEC 10.7) — null si isLive es false.
  liveSince: Date | null;
  sessionCount: number;
};

// Preferencia de formato de hora (ajustes, SPEC 3E-bis) — 24h por defecto.
// Un solo tipo compartido: el main la persiste (config/store.ts), el
// renderer la usa para formatear cualquier datetime (lib/format.ts).
export type TimeFormat = '12h' | '24h';

// Cambio de estado suelto para el desglose "Status Changes" de Stats por
// año (Bloque 5D) — ver getAllStateEvents.ts.
export type StateEventSummary = {
  gameId: number;
  type: StateEvent['type'];
  occurredAt: Date;
};

// Gasto suelto para las métricas globales de Stats (Bloque 5B) — ver
// getAllSpendEvents.ts. Sin gameId/type/note: esta vista solo suma importes
// por fecha (total y por año), no necesita más.
export type SpendEventSummary = {
  amount: number;
  occurredAt: Date;
};

// Sesión de la vista de Sesiones (Bloque 5A) con el juego ya resuelto — ver
// getAllSessions.ts. Campos explícitos (no `Session & {...}`) porque el
// select() que la produce tampoco trae `milestone`: ya filtra por él, no hace
// falta devolverlo (siempre sería null).
export type SessionWithGame = {
  id: number;
  iterationId: number;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  lastHeartbeatAt: Date | null;
  datePrecision: 'year' | 'month' | 'day' | 'datetime';
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
};

export type IterationDetail = Iteration & {
  hours: number;
  startedAt: Date | null;
  endedAt: Date | null;
  currentState: StateEvent['type'] | null;
  sessions: Session[];
  // Gasto atribuido a ESTE playthrough (no el total del juego) — ver
  // getGameById.ts para el algoritmo de reparto entre iteraciones.
  spend: number;
};

export type GameDetail = GameRow & {
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
  totalSpend: number;
  costPerHour: number | null;
  stateHistory: StateEvent[];
  spendHistory: SpendEvent[];
  iterations: IterationDetail[];
};
