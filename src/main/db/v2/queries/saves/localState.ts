import { eq, inArray, isNotNull } from 'drizzle-orm';
import { localSaveState } from '../../schema';
import type { QueryContext } from '../common';

// Estado de partidas de ESTE PC (`local_save_state`, AFTERPLAY-2.0.md §7.6):
// la ubicación elegida para restaurar un juego. Sustituye a
// `saveLocationOverrides` de machine-saves.json, cuya clave es el id numérico
// del juego (`machine.ts`), por una fila por `gameId` de texto.
//
// Es una tabla local (clase L): no viaja, no tiene reloj ni lápidas, y se
// escribe directamente, sin la puerta. Tampoco tiene clave foránea: una fila de
// un juego que ya no existe no molesta, y `purgeGameSaves` la limpia.
//
// `lastSyncedHash` (§12.3) es de la fase 6: aquí no se escribe nunca, pero se
// respeta (borrar el destino no borra la fila si guarda una huella).

/** La ubicación elegida para restaurar un juego en este PC (`MachineSaveOverride`). */
export interface SaveRestoreTarget {
  /** Con barras `/` y sin barra final, como la guarda hoy `setSaveLocationOverride`. */
  readonly target: string;
  readonly setAt: Date;
}

/**
 * Copia de `toSlashes` (`saves/paths.ts`): la 1.x guarda así el destino, y
 * normalizarlo aquí garantiza que nada guardado por otro camino se compare
 * distinto. Es una función pura de texto.
 */
const toSlashes = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');

/** El destino de restauración del juego en este PC, o null (`getSaveLocationOverride`). */
export function getSaveRestoreTarget(ctx: QueryContext, gameId: string): SaveRestoreTarget | null {
  const row = ctx.db
    .select({ target: localSaveState.restoreTarget, setAt: localSaveState.restoreTargetSetAt })
    .from(localSaveState)
    .where(eq(localSaveState.gameId, gameId))
    .get();
  if (!row || row.target === null) return null;
  return { target: row.target, setAt: row.setAt ?? new Date(0) };
}

/**
 * Los destinos de varios juegos (todos si no se indican), por `gameId`.
 * `buildCustomGames` los consulta para toda la biblioteca en cada invocación de
 * ludusavi: así es una lectura y no una por juego.
 */
export function getSaveRestoreTargets(
  ctx: QueryContext,
  gameIds?: readonly string[],
): Map<string, SaveRestoreTarget> {
  if (gameIds !== undefined && gameIds.length === 0) return new Map();
  const rows = ctx.db
    .select({
      gameId: localSaveState.gameId,
      target: localSaveState.restoreTarget,
      setAt: localSaveState.restoreTargetSetAt,
    })
    .from(localSaveState)
    .where(
      gameIds === undefined
        ? isNotNull(localSaveState.restoreTarget)
        : inArray(localSaveState.gameId, [...gameIds]),
    )
    .all();
  const targets = new Map<string, SaveRestoreTarget>();
  for (const row of rows) {
    if (row.target !== null) {
      targets.set(row.gameId, { target: row.target, setAt: row.setAt ?? new Date(0) });
    }
  }
  return targets;
}

/**
 * Fija el destino de restauración del juego en este PC; `null` o vacío lo
 * borra (`setSaveLocationOverride`). La fecha es `ctx.now()`.
 */
export function setSaveRestoreTarget(
  ctx: QueryContext,
  gameId: string,
  target: string | null,
): void {
  const normalized = target ? toSlashes(target) : '';
  if (normalized.length === 0) {
    clearSaveRestoreTarget(ctx, gameId);
    return;
  }
  const setAt = ctx.now();
  ctx.db
    .insert(localSaveState)
    .values({ gameId, restoreTarget: normalized, restoreTargetSetAt: setAt })
    .onConflictDoUpdate({
      target: localSaveState.gameId,
      set: { restoreTarget: normalized, restoreTargetSetAt: setAt },
    })
    .run();
}

function clearSaveRestoreTarget(ctx: QueryContext, gameId: string): void {
  const row = ctx.db
    .select({ hash: localSaveState.lastSyncedHash })
    .from(localSaveState)
    .where(eq(localSaveState.gameId, gameId))
    .get();
  if (!row) return;
  // Sin huella (fase 6) la fila ya no dice nada: fuera, como hoy sale la
  // entrada del JSON. Con huella, solo se vacía el destino.
  if (row.hash === null) {
    ctx.db.delete(localSaveState).where(eq(localSaveState.gameId, gameId)).run();
  } else {
    ctx.db
      .update(localSaveState)
      .set({ restoreTarget: null, restoreTargetSetAt: null })
      .where(eq(localSaveState.gameId, gameId))
      .run();
  }
}
