import type { StateEvent } from '../main/db/schema';

export type { GameRow, Iteration, Session, SpendEvent, StateEvent } from '../main/db/schema';

export type GameListItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
  sessionCount: number;
};
