import { and, eq } from 'drizzle-orm';
import type { Iteration, SpendEvent, StateEvent } from '../../../../../shared/dto';
import { games, playthroughs, spendEvents, stateEvents } from '../../schema';
import { StoreError } from '../../store';
import { livePlaythrough, liveSpendEvent, liveStateEvent } from '../common/alive';
import type { QueryContext } from '../common/context';
import { effectivePlaythroughLabel, playthroughPosition } from '../common/labels';

// Lecturas compartidas por las escrituras de P3: la relectura del DTO después
// de escribir y las comprobaciones de "¿existe y está vivo?" antes de hacerlo.
//
// Vivo es siempre vivo con la regla F-11 (`common/alive.ts`): un playthrough
// cuyo juego tiene lápida está borrado aunque su propia lápida no haya llegado,
// y lo mismo un evento cuyo playthrough o juego la tiene. Si no, se podría
// editar (o apilar eventos en) algo que la interfaz ya no enseña.

/** Cómo está una fila que se va a tocar: no existe, borrada (F-11 incluida) o viva. */
export type RowState = 'missing' | 'deleted' | 'alive';

const stateOf = (row: { alive: unknown } | undefined): RowState =>
  !row ? 'missing' : Number(row.alive) === 1 ? 'alive' : 'deleted';

/** Error estable para "no puedo escribir sobre esto". */
export function storeErrorFor(table: string, id: string, state: 'missing' | 'deleted'): StoreError {
  return state === 'missing'
    ? new StoreError('not_found', `${table}: no existe la fila ${id}`)
    : new StoreError('deleted', `${table}: la fila ${id} está borrada`);
}

// ── Juegos ──────────────────────────────────────────────────────────────────

export interface GameFacts {
  readonly state: RowState;
  readonly endless: boolean;
  readonly addedAt: Date | null;
  readonly promotedAt: Date | null;
}

/** Lo que P3 necesita de un juego para escribir en él. */
export function gameFacts(ctx: QueryContext, gameId: string): GameFacts {
  const row = ctx.db
    .select({
      deleted: games.syncDeleted,
      endless: games.endless,
      addedAt: games.addedAt,
      promotedAt: games.promotedAt,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  if (!row) return { state: 'missing', endless: false, addedAt: null, promotedAt: null };
  return {
    state: row.deleted === null ? 'alive' : 'deleted',
    endless: row.endless,
    addedAt: row.addedAt,
    promotedAt: row.promotedAt,
  };
}

// ── Playthroughs ────────────────────────────────────────────────────────────

/** Estado del playthrough y su juego (F-11). */
export function playthroughState(
  ctx: QueryContext,
  playthroughId: string,
): { state: RowState; gameId: string | null } {
  const row = ctx.db
    .select({ gameId: playthroughs.gameId, alive: livePlaythrough() })
    .from(playthroughs)
    .where(eq(playthroughs.id, playthroughId))
    .get();
  return { state: stateOf(row), gameId: row?.gameId ?? null };
}

/** El playthrough vivo como `Iteration`, con la etiqueta efectiva, o null. */
export function readIteration(ctx: QueryContext, playthroughId: string): Iteration<string> | null {
  const row = ctx.db
    .select()
    .from(playthroughs)
    .where(and(eq(playthroughs.id, playthroughId), livePlaythrough()))
    .get();
  if (!row) return null;
  // La posición cuenta también los borrados (R-03): ver `common/labels.ts`.
  const position = playthroughPosition(ctx, row.id) ?? 1;
  return {
    id: row.id,
    gameId: row.gameId,
    label: effectivePlaythroughLabel(row.customLabel, position),
    playedPlatform: row.playedPlatform,
    origin: row.origin,
    format: row.format,
    manualTotalPlayed: row.manualHours,
    rating: row.rating,
    extraContent: row.extraContent,
  };
}

// ── Eventos de estado ───────────────────────────────────────────────────────

export function stateEventState(ctx: QueryContext, eventId: string): RowState {
  const row = ctx.db
    .select({ alive: liveStateEvent() })
    .from(stateEvents)
    .where(eq(stateEvents.id, eventId))
    .get();
  return stateOf(row);
}

/** El evento vivo (F-11) como `StateEvent`, o null. */
export function readStateEvent(ctx: QueryContext, eventId: string): StateEvent<string> | null {
  const row = ctx.db
    .select({
      id: stateEvents.id,
      iterationId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
      note: stateEvents.note,
    })
    .from(stateEvents)
    .where(and(eq(stateEvents.id, eventId), liveStateEvent()))
    .get();
  return row ?? null;
}

// ── Gastos ──────────────────────────────────────────────────────────────────

export function spendEventState(ctx: QueryContext, spendId: string): RowState {
  const row = ctx.db
    .select({ alive: liveSpendEvent() })
    .from(spendEvents)
    .where(eq(spendEvents.id, spendId))
    .get();
  return stateOf(row);
}

/** El gasto vivo (con su juego vivo) como `SpendEvent`, o null. */
export function readSpendEvent(ctx: QueryContext, spendId: string): SpendEvent<string> | null {
  const row = ctx.db
    .select({
      id: spendEvents.id,
      gameId: spendEvents.gameId,
      type: spendEvents.type,
      amount: spendEvents.amount,
      occurredAt: spendEvents.occurredAt,
      datePrecision: spendEvents.datePrecision,
      note: spendEvents.note,
    })
    .from(spendEvents)
    .where(and(eq(spendEvents.id, spendId), liveSpendEvent()))
    .get();
  return row ?? null;
}
