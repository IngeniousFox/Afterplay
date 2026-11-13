import { eq } from 'drizzle-orm';
import type { GameRow } from '../../../../../shared/dto';
import { games } from '../../schema';
import { canMoveToPlan, readGameRow, type QueryContext } from '../common';
import { GameWriteError } from './errors';
import { writePlanEntry } from './planEntry';

// games:moveToPlan en 2.0 (CONSULTAS.md §2.2, `moveToPlan` y nota 1).
//
// LA CONDICIÓN ("nunca se ha jugado", con su porqué) es `canMoveToPlan` de
// `common/canMoveToPlan.ts`: la MISMA que usa la ficha para ofrecer el gesto,
// releída aquí dentro de la transacción.
//
// DESVIACIÓN de la nota 1 (que proponía poner la lápida al playthrough vacío):
// se CONSERVA, como en la 1.x ("se conserva su iteración"), y la promoción lo
// reutiliza. Con R-03 la etiqueta cuenta también los borrados, así que
// borrarlo y crear otro al promocionar haría que un juego que va y vuelve del
// Plan acabara llamándose "Playthrough 3" sin haberse jugado nunca. Y un id
// aleatorio con lápida no se puede resucitar (`store.create` → `exists`).

const CANNOT_MOVE = 'This game has play records or is already in Plan to Play.';

/**
 * Devuelve el juego al Plan y lo devuelve como `GameRow` (`planned: true`).
 *
 * Una transacción: relee la condición; resucita (o crea) la entrada del Plan
 * con `plannedAt` nuevo, sin pin y conservando su nota (R-06); y deja
 * `games.promotedAt` a null. El juego, su `addedAt`, su playthrough vacío y
 * sus compras se quedan.
 *
 * Lanza `GameWriteError('not_found')` si el juego no existe o tiene lápida, y
 * `GameWriteError('cannot_move_to_plan')` si ya está planeado o tiene
 * registros de partida (mensaje de la 1.x). Sin escribir nada.
 */
export function moveToPlan(ctx: QueryContext, gameId: string): GameRow<string> {
  ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) {
      throw new GameWriteError('not_found', `No existe el juego ${gameId}`);
    }
    if (!canMoveToPlan(ctx, gameId)) throw new GameWriteError('cannot_move_to_plan', CANNOT_MOVE);
    writePlanEntry(ctx, gameId);
    ctx.store.patch('games', gameId, { promotedAt: null });
  });
  const row = readGameRow(ctx, gameId);
  if (!row) throw new Error(`moveToPlan: el juego ${gameId} no se puede releer`);
  return row;
}
