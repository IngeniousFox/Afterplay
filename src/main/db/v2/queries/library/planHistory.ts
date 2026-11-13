import { eq } from 'drizzle-orm';
import { planEntries } from '../../schema';
import type { QueryContext } from '../common/context';
import type { PlanHistory } from './types';

// Los dos eventos del Plan de la ficha (decisión R-06; la forma y su porqué
// están en `types.ts`, `PlanHistory`).
//
// Se lee la entrada de `plan_entries` del juego VIVA O CON LÁPIDA, a
// propósito: la lápida es lo que queda de un juego promocionado, y conserva
// `plannedAt` y `note` (MAPA-1X nota 6). Por eso aquí NO va `alive()` ni
// `livePlanEntry()`: lo que se quiere es justo el historial. La lápida solo
// decide si hay "Salió del Plan". El juego ya se comprobó vivo antes (la
// ficha no llega aquí con un juego borrado).
//
// Por clave primaria: el id de la entrada es el gameId.

/**
 * El último paso del juego por el Plan, o null si nunca pasó por él.
 * `promotedAt` es el `games.promotedAt` ya leído por quien llama.
 */
export function readPlanHistory(
  ctx: QueryContext,
  gameId: string,
  promotedAt: Date | null,
): PlanHistory | null {
  const entry = ctx.db
    .select({
      plannedAt: planEntries.plannedAt,
      note: planEntries.note,
      syncDeleted: planEntries.syncDeleted,
    })
    .from(planEntries)
    .where(eq(planEntries.id, gameId))
    .get();
  if (!entry) return null;
  const stillPlanned = entry.syncDeleted === null;
  return {
    plannedAt: entry.plannedAt,
    note: entry.note,
    // Mientras siga en el Plan no ha salido, aunque `promotedAt` arrastrara
    // un valor (P2 lo anula al devolverlo al Plan; esto no depende de ello).
    leftAt: stillPlanned ? null : promotedAt,
  };
}
