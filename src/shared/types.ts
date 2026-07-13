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

export type { IgdbGameDetail, IgdbSearchResult } from '../main/igdb/types';

export type GameListItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
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
