import { eq } from 'drizzle-orm';
import { planEntries, type PlanEntryRow } from '../../schema';
import type { CreateValues } from '../../store';
import type { QueryContext } from '../common';

// La entrada del Plan de un juego (`plan_entries`, id = gameId) y la regla de
// R-06: el paso por el Plan tiene dos momentos visibles, "Añadido al Plan"
// (`plannedAt`, con su nota) y "Salió del Plan" (`games.promotedAt`, con la
// entrada con lápida). Planear crea la entrada; promocionar le pone la lápida;
// devolver un juego al Plan la RESUCITA con `plannedAt` nuevo, de modo que la
// ficha enseña solo el último paso por el Plan.

/** La fila de la entrada del Plan del juego, viva o con lápida, o undefined. */
export function readPlanEntry(ctx: QueryContext, gameId: string): PlanEntryRow | undefined {
  return ctx.db.select().from(planEntries).where(eq(planEntries.id, gameId)).get();
}

/**
 * Crea la entrada del Plan, o resucita la que tenía lápida. Dentro de la
 * transacción de quien llama, que ya ha comprobado que no hay una viva.
 *
 * - `plannedAt` = ahora, siempre: es la fecha de ESTE paso por el Plan.
 * - Al resucitar, `create` conservaría lo no indicado, así que se indica lo
 *   que no debe volver: el pin de "Up next" (un juego que vuelve al Plan no
 *   reaparece arriba, como en la 1.x, que lo limpiaba al promocionar) y
 *   `sortKey`.
 * - `note`: `undefined` = conservar la que tuviera (devolver al Plan, R-06);
 *   un valor = la nota de este alta. En una fila nueva, un null se omite
 *   (H-2: no consta nada).
 */
export function writePlanEntry(
  ctx: QueryContext,
  gameId: string,
  options: { readonly note?: string | null } = {},
): void {
  const existing = readPlanEntry(ctx, gameId);
  const plannedAt = ctx.now();
  const values: CreateValues<'plan_entries'> = existing
    ? {
        gameId,
        plannedAt,
        pinnedAt: null,
        sortKey: null,
        ...(options.note !== undefined ? { note: options.note } : {}),
      }
    : {
        gameId,
        plannedAt,
        ...(options.note != null ? { note: options.note } : {}),
      };
  ctx.store.create('plan_entries', values);
}
