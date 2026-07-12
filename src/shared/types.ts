import type { GameRow, StateEvent } from '../main/db/schema';

export type { GameRow, Iteration, Session, SpendEvent, StateEvent } from '../main/db/schema';

// currentState tira del literal de StateEvent['type'] en vez de repetirlo.
// Null si el juego no tiene ningún stateEvent todavía (recién añadido, vamos).
export type Game = GameRow & { totalHours: number; currentState: StateEvent['type'] | null };
