import { eq } from 'drizzle-orm';
import type { GameRow, UpdateGamePatch } from '../../../../../shared/dto';
import { gameInstallId } from '../../../../../shared/sync/ids';
import { gameInstalls, games } from '../../schema';
import type { PatchValues } from '../../store';
import type { QueryContext } from './context';
import { readGameRow } from './gameView';

// games:update en 2.0 (CONSULTAS.md §1.4 y §2.2, `updateGame`): el patch del
// modal de editar, el de notas y el de carátula, repartido entre `games` y la
// instalación de ESTE PC, en una sola transacción, y la relectura del juego.
//
// Se queda en `common/` como ejemplo completo de escritura; P2 la usa tal cual
// y añade el patch de partidas (`saves`) con su propio tipo cerrado.
//
// Reparto:
// - `title`, `notes`, `endless`, `isEmulated` → `games`.
// - `coverUrl`, `heroUrl` → `games.coverOverride` / `heroOverride`. Cambio de
//   semántica [S]: `null` = "volver al automático" (el de `game_metadata`), no
//   "sin carátula".
// - `steamGridDbId` → `games.sgdbId` con `sgdbIdSource = 'manual'` (una
//   elección del usuario no la pisa ningún refresco, D-22), o los dos a null.
// - `executablePath`, `installDirectory`, `installSizeBytes` → la fila de
//   `game_installs` de este dispositivo. Si los tres quedan a null, se borra
//   (lápida): "no está instalado aquí" (propuesta de §1.4). Si alguno cambia,
//   `lastVerifiedAt = ahora` (se acaba de elegir, §3.3).
//
// Lo que no está en `UpdateGamePatch` se ignora aunque llegue (el IPC además
// filtra las claves, `ipc/gamePatch.ts`). Un patch vacío o sin cambios no
// escribe nada (F-33) y devuelve el juego tal cual.

const INSTALL_KEYS = ['executablePath', 'installDirectory', 'installSizeBytes'] as const;
type InstallKey = (typeof INSTALL_KEYS)[number];
type InstallValues = { [K in InstallKey]: NonNullable<UpdateGamePatch[K]> | null };

/**
 * Aplica el patch a un juego vivo y devuelve el juego como `GameRow`, o null
 * si no existe o tiene lápida (como la 1.x, que devolvía null sin fila).
 */
export function updateGame(
  ctx: QueryContext,
  gameId: string,
  patch: UpdateGamePatch,
): GameRow<string> | null {
  const updated = ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) return false;

    const gameChanges = gamePatchOf(patch);
    if (Object.keys(gameChanges).length > 0) ctx.store.patch('games', gameId, gameChanges);
    writeInstall(ctx, gameId, patch);
    return true;
  });
  return updated ? readGameRow(ctx, gameId) : null;
}

function gamePatchOf(patch: UpdateGamePatch): PatchValues<'games'> {
  const changes: PatchValues<'games'> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.notes !== undefined) changes.notes = patch.notes;
  if (patch.endless !== undefined) changes.endless = patch.endless;
  if (patch.isEmulated !== undefined) changes.isEmulated = patch.isEmulated;
  if (patch.coverUrl !== undefined) changes.coverOverride = patch.coverUrl;
  if (patch.heroUrl !== undefined) changes.heroOverride = patch.heroUrl;
  if (patch.steamGridDbId !== undefined) {
    changes.sgdbId = patch.steamGridDbId;
    changes.sgdbIdSource = patch.steamGridDbId === null ? null : 'manual';
  }
  return changes;
}

function writeInstall(ctx: QueryContext, gameId: string, patch: UpdateGamePatch): void {
  if (INSTALL_KEYS.every((key) => patch[key] === undefined)) return;

  const id = gameInstallId(gameId, ctx.deviceId);
  const row = ctx.db.select().from(gameInstalls).where(eq(gameInstalls.id, id)).get();
  const isAlive = row !== undefined && row.syncDeleted === null;
  // Lo que había (solo si está viva: una instalación con lápida no aporta
  // nada) con lo que llega encima.
  const current: InstallValues = {
    executablePath: isAlive ? row.executablePath : null,
    installDirectory: isAlive ? row.installDirectory : null,
    installSizeBytes: isAlive ? row.installSizeBytes : null,
  };
  const next: InstallValues = { ...current };
  for (const key of INSTALL_KEYS) {
    const value = patch[key];
    if (value !== undefined) (next as Record<InstallKey, unknown>)[key] = value;
  }

  if (INSTALL_KEYS.every((key) => next[key] === null)) {
    if (isAlive) ctx.store.remove('game_installs', id);
    return;
  }
  if (isAlive && INSTALL_KEYS.every((key) => next[key] === current[key])) return;

  const values = row
    ? // Existe (viva o con lápida): los tres explícitos. Al resucitar una con
      // lápida, `create` conserva lo no indicado, y una ruta vieja de antes de
      // borrarla volvería sin que nadie la eligiera.
      next
    : // Nueva: lo que no consta se omite (lleva reloj BOTTOM, H-2).
      Object.fromEntries(INSTALL_KEYS.filter((key) => next[key] !== null).map((k) => [k, next[k]]));
  ctx.store.create('game_installs', {
    gameId,
    deviceId: ctx.deviceId,
    ...values,
    lastVerifiedAt: ctx.now(),
  });
}
