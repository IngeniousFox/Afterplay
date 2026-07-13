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
  moneySpent: number | null;
  executablePath: string | null;
  // Elegidos a mano en el CoverPicker (SPEC 4.6) — null significa "sin
  // elección propia", el main usa su propio default (detail.covers[0]/
  // heroes[0], la primera candidata de IGDB) igual que hacía antes de que
  // existiera el picker.
  coverUrl: string | null;
  heroUrl: string | null;
};

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
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
  // startedAt de la sesión abierta, para el contador en vivo de la card
  // (SPEC 10.7) — null si isLive es false.
  liveSince: Date | null;
  sessionCount: number;
};

export type IterationDetail = Iteration & {
  hours: number;
  startedAt: Date | null;
  endedAt: Date | null;
  currentState: StateEvent['type'] | null;
  sessions: Session[];
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
