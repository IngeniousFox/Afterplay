import { and, eq, isNotNull } from 'drizzle-orm';
import { redistributePinStamps } from '../../../../../shared/domain/planOrder';
import { planEntries } from '../../schema';
import { livePlanEntry, type QueryContext } from '../common';

// "Up next" del Plan en 2.0 (CONSULTAS.md §1.4 y §2.2, `setPlanPinned` y
// `reorderUpNext`). El orden sigue siendo por marca de fijado
// (`plan_entries.pinnedAt`), como hoy; `sortKey` espera a la fase 5.

/**
 * Fija (marca = `pinnedAt` o ahora) o suelta (null) un juego del Plan. Soltar
 * y volver a fijar da una marca nueva: te manda al final de la estantería.
 *
 * Devuelve false, sin escribir, si el juego no tiene entrada del Plan viva (no
 * existe, está borrado o ya se promocionó): ese false es contrato, quien lo
 * pide lo lee como "esta orden no hizo nada". true en otro caso, también si la
 * marca ya era esa (no se escribe, F-33).
 */
export function setPlanPinned(
  ctx: QueryContext,
  gameId: string,
  pinned: boolean,
  pinnedAt?: Date,
): boolean {
  return ctx.store.transaction(() => {
    const entry = ctx.db
      .select({ id: planEntries.id })
      .from(planEntries)
      .where(and(eq(planEntries.id, gameId), livePlanEntry()))
      .get();
    if (!entry) return false;
    ctx.store.patch('plan_entries', gameId, {
      pinnedAt: pinned ? (pinnedAt ?? ctx.now()) : null,
    });
    return true;
  });
}

/**
 * Reordena Up next repartiendo las marcas que YA existen entre los ids, en el
 * orden recibido (`redistributePinStamps`: solo los que siguen fijados y
 * planeados, sin repetidos, estrictamente crecientes). Solo escribe las marcas
 * que cambian de mano, en una transacción.
 *
 * Devuelve false si no hay nada que repartir (menos de dos fijados entre los
 * ids), true si se aplicó.
 */
export function reorderUpNext(ctx: QueryContext, orderedIds: readonly string[]): boolean {
  return ctx.store.transaction(() => {
    const pinned = ctx.db
      .select({ id: planEntries.id, pinnedAt: planEntries.pinnedAt })
      .from(planEntries)
      .where(and(livePlanEntry(), isNotNull(planEntries.pinnedAt)))
      .all();
    const stamps = redistributePinStamps<string>(
      pinned.map((row) => ({ id: row.id, pinnedAt: row.pinnedAt?.getTime() ?? null })),
      orderedIds,
    );
    if (stamps.size === 0) return false;
    for (const [id, stamp] of stamps) {
      ctx.store.patch('plan_entries', id, { pinnedAt: new Date(stamp) });
    }
    return true;
  });
}
