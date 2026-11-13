import { eq } from 'drizzle-orm';
import { planEntries } from '../../schema';
import type { QueryContext } from '../common/context';
import type { PlanHistory } from '../../../../../shared/types';

// Los dos eventos del Plan de la ficha (decisión R-06; la forma y su porqué
// están en `shared/types.ts`, `PlanHistory`).
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
 * `promotedAt` y `addedAt` son los de `games`, ya leídos por quien llama.
 */
export function readPlanHistory(
  ctx: QueryContext,
  gameId: string,
  promotedAt: Date | null,
  addedAt: Date,
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
  // Una entrada con lápida puede ser de una VIDA ANTERIOR del juego: es lo
  // que queda cuando se borra un juego planeado (o promocionado) y se vuelve
  // a añadir con el mismo igdbId (la lápida del juego arrastra la de su
  // entrada, y la resurrección no la toca). Enseñarla daría un "Añadido al
  // Plan" de la otra vida (lo destapó la prueba de integración, I-11).
  //
  // La señal es la fecha: volver a añadir el juego RENUEVA `addedAt` (es su
  // alta en esta vida), y todo paso por el Plan de esta vida es posterior o
  // igual al alta (planear un juego nuevo escribe los dos con el mismo
  // "ahora"; devolverlo al Plan, después). Una entrada con `plannedAt`
  // anterior al alta actual solo puede ser de antes.
  //
  // No vale "lápida sin `promotedAt`", que era la regla anterior: también la
  // cumplen los juegos importados de la 1.x que se promocionaron antes de que
  // existiera esa columna (I-14). Esos SÍ pasaron por el Plan en esta vida:
  // se enseña su "Añadido al Plan" y "Salió del Plan" queda en null porque no
  // se sabe cuándo fue.
  if (!stillPlanned && entry.plannedAt.getTime() < addedAt.getTime()) return null;
  return {
    plannedAt: entry.plannedAt,
    note: entry.note,
    // Mientras siga en el Plan no ha salido, aunque `promotedAt` arrastrara
    // un valor (P2 lo anula al devolverlo al Plan; esto no depende de ello).
    leftAt: stillPlanned ? null : promotedAt,
  };
}
