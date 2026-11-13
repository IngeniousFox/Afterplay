import type { GameRow } from '../../../../../shared/dto';
import type { CreateGameWithDetailsInput } from '../../../../../shared/types';
import { readGameRow, updateGame, type QueryContext } from '../common';
import {
  assertInitialStatus,
  initialPlaythroughValues,
  writeInitialPapers,
} from './initialPlaythrough';
import { writeNewGame, type GameEnrichmentData } from './newGame';

// games:createWithDetails en 2.0 (CONSULTAS.md §1.4 y §2.2): el alta normal.
//
// Antes de llamar, FUERA de toda transacción, el IPC resuelve la red:
//   const request = planEnrichmentRequest(input);
//   const enrichment = await resolveGameEnrichment(request.source, request.overrides);
// y luego llama a esta función, síncrona, que escribe todo en UNA transacción:
// `games` + `game_metadata` + `external_checks` (ver `writeNewGame`), la
// instalación de este PC si llega alguna ruta, el primer playthrough y su
// papeleo (gasto y estados).

export interface CreateGameOptions {
  /** Moneda del gasto inicial (D-23), de la configuración. */
  readonly currency: string;
}

/**
 * Da de alta el juego y devuelve su `GameRow`.
 *
 * Lanza (sin escribir nada):
 * - `GameWriteError('invalid_input')`: appid forzado fuera de rango, o
 *   `initialStatus = 'plan_to_play'`.
 * - `GameWriteError('already_exists')`: ya hay un juego VIVO con ese igdbId
 *   (en la biblioteca o en el Plan). La 1.x creaba un duplicado; en 2.0 el id
 *   determinista lo impide. Para un juego del Plan, lo que toca es promoverlo.
 * - `StoreError` de la puerta ante valores inválidos (se propaga).
 *
 * Si el igdbId era de un juego BORRADO, el juego resucita (ver `writeNewGame`)
 * con un playthrough nuevo; los antiguos siguen borrados.
 */
export function createGameWithDetails(
  ctx: QueryContext,
  input: CreateGameWithDetailsInput,
  enrichment: GameEnrichmentData,
  options: CreateGameOptions,
): GameRow<string> {
  assertInitialStatus(input.initialStatus);
  const gameId = ctx.store.transaction(() => {
    const { gameId, addedAt } = writeNewGame(ctx, {
      enrichment,
      choices: input,
      notes: input.gameNotes,
      endless: input.endless,
      isEmulated: input.isEmulated,
    });
    writeInstallIfAny(ctx, gameId, input);
    const { id: playthroughId } = ctx.store.create('playthroughs', {
      gameId,
      ...initialPlaythroughValues(input),
    });
    writeInitialPapers(ctx, {
      gameId,
      playthroughId,
      anchor: addedAt,
      currency: options.currency,
      input,
    });
    return gameId;
  });
  // La relectura puede ir fuera: la escritura ya está confirmada.
  const row = readGameRow(ctx, gameId);
  if (!row) throw new Error(`createGameWithDetails: el juego ${gameId} no se puede releer`);
  return row;
}

/**
 * La instalación de ESTE PC, solo si se eligió alguna ruta. Reutiliza el
 * reparto de `updateGame` (common), que ya sabe crear la fila omitiendo lo
 * que no consta, o escribir los tres campos si resucita una fila con lápida
 * (sin traer rutas viejas que nadie eligió ahora).
 */
function writeInstallIfAny(
  ctx: QueryContext,
  gameId: string,
  input: Pick<
    CreateGameWithDetailsInput,
    'executablePath' | 'installDirectory' | 'installSizeBytes'
  >,
): void {
  if (
    input.executablePath === null &&
    input.installDirectory === null &&
    input.installSizeBytes === null
  ) {
    return;
  }
  updateGame(ctx, gameId, {
    executablePath: input.executablePath,
    installDirectory: input.installDirectory,
    installSizeBytes: input.installSizeBytes,
  });
}
