import { and, eq } from 'drizzle-orm';
import type { GameRow, UpdateGamePatch } from '../../../../../shared/dto';
import type { PromotePlannedGameInput } from '../../../../../shared/types';
import { games, playthroughs } from '../../schema';
import { alive } from '../../store';
import {
  DEFAULT_CURRENCY,
  playthroughCreationOrder,
  readGameRow,
  updateGame,
  type QueryContext,
} from '../common';
import { GameWriteError } from './errors';
import {
  assertInitialStatus,
  initialPlaythroughValues,
  writeInitialPapers,
} from './initialPlaythrough';
import { readPlanEntry } from './planEntry';

// games:promote en 2.0 (CONSULTAS.md §1.4, `PromotePlannedGameInput`, y R-06):
// pasar un juego del Plan a la biblioteca. No hay red: todo lo externo se
// trajo al planearlo, así que es una sola transacción.
//
// - La entrada del Plan recibe la LÁPIDA (conserva `plannedAt` y la nota: es
//   el "Añadido al Plan" que la ficha sigue enseñando) y `games.promotedAt`
//   pasa a ser ahora ("Salió del Plan"). El id del juego no cambia y
//   `addedAt` tampoco (de él salen la espera del Plan y "Longest waiting").
// - El resto de campos del modal van a `games` y a la instalación de este PC
//   por el mismo reparto que `updateGame`. Arte, SteamGridDB y notas solo si
//   el modal trae elección propia: null (o carátula vacía) = conservar lo que
//   se eligió al planear, como la 1.x (`promotePlannedGame.ts:62-65`). Las
//   rutas se escriben siempre (null = sin instalación aquí).
// - [S] El primer playthrough: si el juego conserva uno vivo (volvió de la
//   biblioteca con `moveToPlan`, que no lo borra), se reutiliza y se rellena,
//   como la 1.x reutilizaba la iteración del alta; si no, se crea. Después, el
//   papeleo inicial anclado en `promotedAt` (R-07).

export interface PromotePlannedGameOptions {
  /** Moneda del gasto inicial (D-23). Por defecto `DEFAULT_CURRENCY` (common/currency.ts). */
  readonly currency?: string;
}

/**
 * Promociona el juego y lo devuelve como `GameRow` (`planned: false`).
 *
 * Lanza, sin escribir nada:
 * - `GameWriteError('not_found')` — "No existe el juego X".
 * - `GameWriteError('not_planned')` — "El juego X no está en Plan to Play"
 *   (promocionar dos veces no duplica el papeleo).
 * - `GameWriteError('invalid_input')` si `initialStatus = 'plan_to_play'`.
 */
export function promotePlannedGame(
  ctx: QueryContext,
  input: PromotePlannedGameInput<string>,
  options: PromotePlannedGameOptions = {},
): GameRow<string> {
  assertInitialStatus(input.initialStatus);
  const { gameId } = input;
  ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) {
      throw new GameWriteError('not_found', `No existe el juego ${gameId}`);
    }
    const plan = readPlanEntry(ctx, gameId);
    if (!plan || plan.syncDeleted !== null) {
      throw new GameWriteError('not_planned', `El juego ${gameId} no está en Plan to Play`);
    }

    const promotedAt = ctx.now();
    ctx.store.remove('plan_entries', gameId);
    ctx.store.patch('games', gameId, { promotedAt });
    updateGame(ctx, gameId, promotePatch(input));

    const playthroughId = reuseOrCreatePlaythrough(ctx, gameId, input);
    writeInitialPapers(ctx, {
      gameId,
      playthroughId,
      anchor: promotedAt,
      // Como en el alta: solo `undefined` toma el valor por defecto.
      currency: options.currency === undefined ? DEFAULT_CURRENCY : options.currency,
      input,
    });
  });
  const row = readGameRow(ctx, gameId);
  if (!row) throw new Error(`promotePlannedGame: el juego ${gameId} no se puede releer`);
  return row;
}

function promotePatch(input: PromotePlannedGameInput<string>): UpdateGamePatch {
  return {
    endless: input.endless,
    isEmulated: input.isEmulated,
    executablePath: input.executablePath,
    installDirectory: input.installDirectory,
    installSizeBytes: input.installSizeBytes,
    // Las notas se pisan con cualquier texto, también el vacío: solo null
    // significa "no traigo elección" (la cicatriz de `plan.test.ts`).
    ...(input.gameNotes !== null ? { notes: input.gameNotes } : {}),
    // El arte, con la regla de la 1.x: una cadena vacía tampoco es elección.
    ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
    ...(input.heroUrl ? { heroUrl: input.heroUrl } : {}),
    ...(input.steamGridDbId !== null ? { steamGridDbId: input.steamGridDbId } : {}),
  };
}

function reuseOrCreatePlaythrough(
  ctx: QueryContext,
  gameId: string,
  input: PromotePlannedGameInput<string>,
): string {
  const values = initialPlaythroughValues(input);
  const existing = ctx.db
    .select({ id: playthroughs.id })
    .from(playthroughs)
    .where(and(eq(playthroughs.gameId, gameId), alive(playthroughs)))
    .orderBy(...playthroughCreationOrder)
    .limit(1)
    .get();
  if (existing) {
    // Sobre una fila existente, las horas se escriben siempre: null = sin
    // horas manuales (como la 1.x, que escribía `manualTotalPlayed` tal cual).
    ctx.store.patch('playthroughs', existing.id, {
      ...values,
      manualHours: input.hoursPlayed,
    });
    return existing.id;
  }
  return ctx.store.create('playthroughs', { gameId, ...values }).id;
}
