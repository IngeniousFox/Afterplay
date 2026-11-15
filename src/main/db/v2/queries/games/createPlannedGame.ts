import type { GameRow } from '../../../../../shared/dto';
import type { CreatePlannedGameInput } from '../../../../../shared/types';
import { readGameRow, type QueryContext } from '../common';
import { writePlanEntry } from './planEntry';
import { writeNewGame, type GameEnrichmentData } from './newGame';

// games:createPlanned en 2.0 (CONSULTAS.md §1.4, `CreatePlannedGameInput`):
// el alta en Plan to Play.
//
// [S] Ya no hay iteración vacía ni evento `plan_to_play` (F-12, R-06): un
// juego está planeado porque tiene `plan_entries` viva, con `plannedAt` (el
// "Añadido al Plan" que pinta la ficha) y la nota de por qué lo planeas. El
// primer playthrough lo crea la promoción, que es donde el modal pregunta la
// plataforma de verdad.
//
// La red va antes y fuera, como en el alta normal: `planEnrichmentRequest` +
// `resolveGameEnrichment`, y el resultado llega aquí como dato.

/**
 * Da de alta el juego en el Plan y devuelve su `GameRow` (`planned: true`).
 *
 * Lanza `GameWriteError('already_exists')` si ya hay un juego VIVO con ese
 * igdbId, y `StoreError` ante valores inválidos; en ningún caso queda nada
 * escrito. Un igdbId de un juego borrado lo resucita, ya planeado.
 *
 * `stampChecks: false` no escribe `external_checks`: es el alta del móvil, con
 * los datos mínimos de la búsqueda, y deja la ficha para que un PC la complete.
 */
export function createPlannedGame(
  ctx: QueryContext,
  input: CreatePlannedGameInput,
  enrichment: GameEnrichmentData,
  options: { readonly stampChecks?: boolean } = {},
): GameRow<string> {
  const gameId = ctx.store.transaction(() => {
    const { gameId } = writeNewGame(ctx, {
      enrichment,
      choices: input,
      notes: input.gameNotes,
      stampChecks: options.stampChecks,
    });
    writePlanEntry(ctx, gameId, { note: input.note });
    return gameId;
  });
  const row = readGameRow(ctx, gameId);
  if (!row) throw new Error(`createPlannedGame: el juego ${gameId} no se puede releer`);
  return row;
}
