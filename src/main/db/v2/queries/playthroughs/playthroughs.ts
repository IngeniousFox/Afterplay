import type { Iteration } from '../../../../../shared/dto';
import type { CreateValues, PatchValues } from '../../store';
import type { QueryContext } from '../common/context';
import { customLabelToStore, nextPlaythroughPosition, playthroughPosition } from '../common/labels';
import { gameFacts, playthroughState, readIteration, storeErrorFor } from './read';
import type { CreatePlaythroughInput, UpdatePlaythroughPatch } from './types';

// Crear, editar y borrar playthroughs (antes "iteraciones") sobre el esquema
// 2.0 (CONSULTAS.md §1.4 y §2.2 "iterations"). Los DTO siguen llamándose
// `Iteration` y las funciones conservan el nombre de la 1.x para que el
// cambio del IPC (P9) sea un reemplazo de llamada.
//
// Cambios de semántica [S]:
// - La etiqueta "Playthrough N" ya no se guarda (§7.4, R-03): es la posición
//   del playthrough en su juego. `label` del input se guarda en `customLabel`
//   SOLO si no coincide con la automática de su posición (`customLabelToStore`);
//   el DTO devuelve siempre la etiqueta efectiva.
// - `manualTotalPlayed` del DTO es `manualHours`: horas no medidas que se SUMAN
//   a las sesiones (§7.4, §7.5). Mismo valor, un solo significado.

/**
 * iterations:create. Crea el playthrough y lo devuelve releído.
 *
 * - `label` vacío, null o igual a "Playthrough N" de la posición que va a
 *   ocupar → `customLabel` omitido (etiqueta automática).
 * - Lo que no viene se omite, no se escribe como null (H-2).
 * - Juego inexistente → `StoreError('not_found')`; con lápida →
 *   `StoreError('deleted')`. En la 1.x reventaba la clave foránea; aquí se
 *   dice con un código estable y sin escribir nada.
 *
 * Una transacción: la posición que se compara con el texto y la fila que la
 * ocupa no se pueden separar (otra escritura en medio cambiaría el número).
 */
export function createIteration(
  ctx: QueryContext,
  input: CreatePlaythroughInput,
): Iteration<string> {
  const id = ctx.store.transaction(() => {
    const game = gameFacts(ctx, input.gameId);
    if (game.state !== 'alive') throw storeErrorFor('games', input.gameId, game.state);

    const customLabel = customLabelToStore(input.label, nextPlaythroughPosition(ctx, input.gameId));
    const values: CreateValues<'playthroughs'> = {
      gameId: input.gameId,
      playedPlatform: input.playedPlatform,
      origin: input.origin,
      ...(customLabel !== null ? { customLabel } : {}),
      ...(input.format !== undefined ? { format: input.format } : {}),
      ...(input.manualTotalPlayed !== undefined ? { manualHours: input.manualTotalPlayed } : {}),
    };
    return ctx.store.create('playthroughs', values).id;
  });
  const created = readIteration(ctx, id);
  if (!created) throw new Error(`playthroughs: la fila ${id} desapareció al crearla`);
  return created;
}

/**
 * iterations:update. Aplica el patch y devuelve el playthrough releído.
 *
 * - Null si no existe o está borrado (F-11 incluida: su juego con lápida), como
 *   la 1.x cuando el UPDATE no encontraba fila.
 * - Patch vacío o sin cambios: no escribe (F-33) y devuelve la fila tal cual
 *   (guardar el modal de editar sin tocar el playthrough es legítimo).
 * - `label`: texto vacío o igual a la automática de su posición → `customLabel`
 *   null, para no congelar un "Playthrough 2" que deje de cuadrar (§1.4).
 */
export function updateIteration(
  ctx: QueryContext,
  playthroughId: string,
  patch: UpdatePlaythroughPatch,
): Iteration<string> | null {
  const updated = ctx.store.transaction(() => {
    if (playthroughState(ctx, playthroughId).state !== 'alive') return false;

    const changes: PatchValues<'playthroughs'> = {};
    if (patch.label !== undefined) {
      const position = playthroughPosition(ctx, playthroughId) ?? 1;
      changes.customLabel = customLabelToStore(patch.label, position);
    }
    if (patch.playedPlatform !== undefined) changes.playedPlatform = patch.playedPlatform;
    if (patch.origin !== undefined) changes.origin = patch.origin;
    if (patch.format !== undefined) changes.format = patch.format;
    if (patch.manualTotalPlayed !== undefined) changes.manualHours = patch.manualTotalPlayed;
    if (patch.extraContent !== undefined) changes.extraContent = patch.extraContent;
    if (patch.rating !== undefined) changes.rating = patch.rating;
    if (Object.keys(changes).length > 0) ctx.store.patch('playthroughs', playthroughId, changes);
    return true;
  });
  return updated ? readIteration(ctx, playthroughId) : null;
}

/**
 * iterations:delete. Lápida al playthrough y, en la misma operación de la
 * puerta, lo que arrastra el registro (`registry.ts`, `playthroughs`):
 *
 * - `state_events` y `sessions` del playthrough reciben lápida (antes, ON
 *   DELETE CASCADE). También las sesiones de otros PCs, abiertas incluidas: es
 *   la cascada decidida en `store/owner.ts`.
 * - `spend_events.playthroughId` y `achievement_unlocks.playthroughId` se
 *   anulan (`nullify`): el gasto sigue siendo del juego (se reparte por fecha)
 *   y el logro sigue sacado. No se borran.
 *
 * El estado del juego no se toca: se deriva al leer del log que queda (SPEC
 * 4.5, igual que en la 1.x).
 *
 * Devuelve true si lo ha borrado esta llamada; false si no existía o ya estaba
 * borrado (F-11 incluida: con el juego borrado no hay nada que borrar aquí).
 */
export function deleteIteration(ctx: QueryContext, playthroughId: string): boolean {
  return ctx.store.transaction(() => {
    if (playthroughState(ctx, playthroughId).state !== 'alive') return false;
    return ctx.store.remove('playthroughs', playthroughId).removed.length > 0;
  });
}
