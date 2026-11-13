import { asc } from 'drizzle-orm';
import type { SpendEvent } from '../../../../../shared/dto';
import type { SpendEventSummary } from '../../../../../shared/types';
import { spendEvents } from '../../schema';
import { StoreError, type CreateValues, type PatchValues } from '../../store';
import { liveSpendEvent } from '../common/alive';
import type { QueryContext } from '../common/context';
import {
  gameFacts,
  playthroughState,
  readSpendEvent,
  spendEventState,
  storeErrorFor,
} from './read';
import type { AddSpendEventInputV2, UpdateSpendEventPatchV2 } from './types';

// Los gastos sobre el esquema 2.0 (CONSULTAS.md §2.2 "spend"). El gasto cuelga
// del JUEGO, no del playthrough (SPEC Nivel 1 bis): puede haber gasto sin haber
// jugado nunca. `playthroughId` es opcional y, sin él, el reparto entre
// playthroughs se hace por fecha al leer (`shared/domain/spend.ts`).

/**
 * La moneda que se guarda en cada gasto nuevo (D-23: una sola moneda en la
 * interfaz; cada gasto guarda la suya por si algún día hay varias).
 *
 * Por qué una constante y no un ajuste: la app no tiene hoy ninguna moneda
 * configurable; pinta siempre euros (`formatMoney` en `shared/format.ts`), y el
 * importador de la 1.x escribe también `EUR` en todo lo que trae
 * (`MAPA-1X.md`, `spend_events.currency`). Escribir otra cosa aquí haría que
 * un mismo historial mezclase monedas sin que la interfaz lo supiera. El día
 * que haya un ajuste de moneda, este valor pasa a llegar por parámetro (o por
 * el contexto) y el resto no cambia. Cambio pedido: moverla a `common/` para
 * que P2 (alta con gasto) use la misma.
 */
export const DEFAULT_CURRENCY = 'EUR';

/**
 * spend:add. Crea el gasto y lo devuelve releído.
 *
 * - `occurredAt` omitido → "ahora" (`ctx.now()`), de forma explícita: el
 *   esquema 2.0 no tiene DEFAULT de fecha.
 * - `currency` = `DEFAULT_CURRENCY`.
 * - `playthroughId` opcional (omitido o null = repartir por fecha). Si viene,
 *   tiene que ser un playthrough vivo del MISMO juego: si no →
 *   `StoreError('not_found' | 'deleted')`, o `'invalid_value'` si es de otro
 *   juego (un gasto así se repartiría en un juego y se contaría en otro).
 * - Juego inexistente → `StoreError('not_found')`; borrado → `'deleted'`.
 */
export function addSpendEvent(ctx: QueryContext, input: AddSpendEventInputV2): SpendEvent<string> {
  const id = ctx.store.transaction(() => {
    const game = gameFacts(ctx, input.gameId);
    if (game.state !== 'alive') throw storeErrorFor('games', input.gameId, game.state);

    const playthroughId = input.playthroughId ?? null;
    if (playthroughId !== null) {
      const target = playthroughState(ctx, playthroughId);
      if (target.state !== 'alive')
        throw storeErrorFor('playthroughs', playthroughId, target.state);
      if (target.gameId !== input.gameId) {
        throw new StoreError(
          'invalid_value',
          `spend_events.playthroughId: ${playthroughId} no es un playthrough del juego ${input.gameId}`,
        );
      }
    }

    const values: CreateValues<'spend_events'> = {
      gameId: input.gameId,
      type: input.type,
      amount: input.amount,
      currency: DEFAULT_CURRENCY,
      occurredAt: input.occurredAt ?? ctx.now(),
      datePrecision: input.datePrecision,
      ...(playthroughId !== null ? { playthroughId } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    return ctx.store.create('spend_events', values).id;
  });
  const created = readSpendEvent(ctx, id);
  if (!created) throw new Error(`spend_events: la fila ${id} desapareció al crearla`);
  return created;
}

/**
 * spend:update. Corrección de cantidad, fecha, precisión o nota. El tipo se
 * queda como se registró (cambiarlo es borrar y crear), como en la 1.x.
 *
 * - Null si el gasto no existe o está borrado (con su juego borrado también).
 * - Patch vacío o sin cambios: no escribe (F-33) y devuelve el gasto.
 */
export function updateSpendEvent(
  ctx: QueryContext,
  spendId: string,
  patch: UpdateSpendEventPatchV2,
): SpendEvent<string> | null {
  const updated = ctx.store.transaction(() => {
    if (spendEventState(ctx, spendId) !== 'alive') return false;
    const changes: PatchValues<'spend_events'> = {};
    if (patch.amount !== undefined) changes.amount = patch.amount;
    if (patch.occurredAt !== undefined) changes.occurredAt = patch.occurredAt;
    if (patch.datePrecision !== undefined) changes.datePrecision = patch.datePrecision;
    if (patch.note !== undefined) changes.note = patch.note;
    if (Object.keys(changes).length > 0) ctx.store.patch('spend_events', spendId, changes);
    return true;
  });
  return updated ? readSpendEvent(ctx, spendId) : null;
}

/**
 * spend:delete. Lápida al gasto. True si lo ha borrado esta llamada; false si
 * no existía o ya estaba borrado (con su juego borrado también).
 */
export function deleteSpendEvent(ctx: QueryContext, spendId: string): boolean {
  return ctx.store.transaction(() => {
    if (spendEventState(ctx, spendId) !== 'alive') return false;
    return ctx.store.remove('spend_events', spendId).removed.length > 0;
  });
}

/**
 * spend:getAll. Todos los gastos vivos con su juego vivo (F-11), para las
 * métricas de Stats y el coste por hora del modo ambiente. Mismo contrato que
 * la 1.x: `{gameId, amount, occurredAt}`. Un playthrough borrado no oculta el
 * gasto (es una referencia `nullify`, no su padre).
 */
export function getAllSpendEvents(ctx: QueryContext): SpendEventSummary<string>[] {
  return ctx.db
    .select({
      gameId: spendEvents.gameId,
      amount: spendEvents.amount,
      occurredAt: spendEvents.occurredAt,
    })
    .from(spendEvents)
    .where(liveSpendEvent())
    .orderBy(asc(spendEvents.occurredAt), asc(spendEvents.syncCreated), asc(spendEvents.id))
    .all();
}
