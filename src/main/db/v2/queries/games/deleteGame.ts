import { eq } from 'drizzle-orm';
import { games } from '../../schema';
import type { QueryContext } from '../common';

// games:delete en 2.0 (CONSULTAS.md §2.2, `deleteGame`).
//
// La 1.x borraba la fila y la cascada SQL se llevaba todo. En 2.0 borrar es
// poner la lápida, y la puerta marca en la MISMA transacción a los hijos que
// dice el registro (`registry.ts`, `games.children`): playthroughs (y con
// ellos sus eventos y sesiones, también abiertas y de otros PCs), la entrada
// del Plan, los gastos, las instalaciones de todos los PCs y los desbloqueos.
//
// Se QUEDAN, por decisión (referencias `keep`): las cachés (`game_metadata`,
// `external_checks`, catálogos de logros, curiosidades), para que volver a
// añadir el mismo juego (mismo id) no repita llamadas ni repague curiosidades,
// y las copias de partidas, que son el índice de objetos reales del bucket
// (el IPC llama antes a `purgeGameSaves`, que borra los objetos).

/**
 * Pone la lápida al juego y a lo suyo. Devuelve false si el id no existe o ya
 * estaba borrado (el segundo clic de dos ventanas contesta "ya no está" sin
 * lanzar), true si lo ha borrado ahora.
 */
export function deleteGame(ctx: QueryContext, gameId: string): boolean {
  return ctx.store.transaction(() => {
    const row = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!row || row.deleted !== null) return false;
    return ctx.store.remove('games', gameId).removed.length > 0;
  });
}
