import { eq } from 'drizzle-orm';
import type { GameRow } from '../../../../../shared/dto';
import { games, type SaveDetectionSource } from '../../schema';
import type { PatchValues } from '../../store';
import { readGameRow, type QueryContext } from '../common';

// games:update en 2.0. El patch del modal de editar (`UpdateGamePatch`) ya lo
// reparte `common/updateGame.ts`, que se reexporta tal cual: no se reescribe.
//
// Lo que añade P2 es el patch INTERNO de partidas guardadas, el que hoy
// `ipc/saves.ts` (líneas 156, 220, 238, 265, 292 y 313) manda por el mismo
// `updateGame` con el tipo abierto `GamePatch` de `db/writeTypes.ts`. En 2.0
// tiene su propio tipo cerrado (§1.4): solo las cuatro columnas de partidas,
// que van todas a `games`.
export { updateGame } from '../common';

/**
 * Cambio pedido (§1.4): el tipo cerrado que debería usar `ipc/saves.ts` en
 * lugar de `GamePatch`. Vive aquí hasta que P9 decida si sube a `shared/dto`.
 */
export type SaveGamePatch = {
  saveBackupEnabled?: boolean;
  saveDetectionSource?: SaveDetectionSource | null;
  saveLudusaviName?: string | null;
  saveCustomPaths?: string[] | null;
};

const SAVE_KEYS = [
  'saveBackupEnabled',
  'saveDetectionSource',
  'saveLudusaviName',
  'saveCustomPaths',
] as const satisfies readonly (keyof SaveGamePatch)[];

/**
 * Aplica el patch de partidas a un juego vivo y lo devuelve releído, o null
 * si no existe o tiene lápida (como `updateGame`). Las claves fuera de la
 * lista se ignoran; un patch sin cambios no escribe (F-33).
 */
export function updateGameSaves(
  ctx: QueryContext,
  gameId: string,
  patch: SaveGamePatch,
): GameRow<string> | null {
  const updated = ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) return false;
    const changes: PatchValues<'games'> = {};
    for (const key of SAVE_KEYS) {
      if (patch[key] !== undefined) (changes as Record<string, unknown>)[key] = patch[key];
    }
    if (Object.keys(changes).length > 0) ctx.store.patch('games', gameId, changes);
    return true;
  });
  return updated ? readGameRow(ctx, gameId) : null;
}
