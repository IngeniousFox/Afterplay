import { and, desc, eq, isNotNull } from 'drizzle-orm';
import {
  devices,
  games,
  localJobState,
  localLegacyIds,
  localSaveState,
  saveBackups,
} from '../../schema';
import type { QueryContext } from '../common';
import { liveGame, liveRow } from '../common';
import { getLastSyncedHash, setLastSyncedHash, setSaveRestoreTarget } from './localState';

// Lo que las partidas guardadas tienen que hacer DESPUÉS de importar la 1.x
// (AFTERPLAY-2.0.md §19.5-19.6). El importador no migra `save_backups`: el
// índice se reindexa desde el bucket cuando hay credenciales, y a partir de
// ese índice se siembra `lastSyncedHash`. Todo es estado LOCAL (clase L): ni
// viaja ni pasa por la puerta de escritura.

/** El trabajo pendiente en `local_job_state` (§14). */
export const SAVE_REINDEX_JOB = 'saves_reindex_after_import';

// ── Marcador de "reindexado pendiente" ──────────────────────────────────────
//
// Una fila de `local_job_state`: existe y `lastOkAt` es null = pendiente. Al
// terminar bien se rellena `lastOkAt`; un fallo deja `lastError` y la fila
// pendiente, así que el siguiente arranque lo reintenta. No hay fila = nunca
// hubo importación (o ya no hace falta): no se reindexa nada por sistema.

/** Deja el reindexado pendiente. Idempotente; una importación nueva lo reabre. */
export function markSaveReindexPending(ctx: QueryContext): void {
  ctx.db
    .insert(localJobState)
    .values({ job: SAVE_REINDEX_JOB })
    .onConflictDoUpdate({
      target: localJobState.job,
      set: { lastRunAt: null, lastOkAt: null, lastError: null },
    })
    .run();
}

/** ¿Falta reindexar el bucket tras una importación? */
export function isSaveReindexPending(ctx: QueryContext): boolean {
  const row = ctx.db
    .select({ lastOkAt: localJobState.lastOkAt })
    .from(localJobState)
    .where(eq(localJobState.job, SAVE_REINDEX_JOB))
    .get();
  return row !== undefined && row.lastOkAt === null;
}

/** Anota el resultado de un intento: ok lo da por hecho, un error lo deja pendiente. */
export function recordSaveReindexRun(
  ctx: QueryContext,
  result: { readonly ok: true } | { readonly ok: false; readonly error: string },
): void {
  const now = ctx.now();
  ctx.db
    .update(localJobState)
    .set(
      result.ok
        ? { lastRunAt: now, lastOkAt: now, lastError: null }
        : { lastRunAt: now, lastError: result.error.slice(0, 500) },
    )
    .where(eq(localJobState.job, SAVE_REINDEX_JOB))
    .run();
}

/** El último error del reindexado pendiente (para el log y los tests), o null. */
export function getSaveReindexError(ctx: QueryContext): string | null {
  return (
    ctx.db
      .select({ error: localJobState.lastError })
      .from(localJobState)
      .where(eq(localJobState.job, SAVE_REINDEX_JOB))
      .get()?.error ?? null
  );
}

// ── Siembra de lastSyncedHash (§19.6 "Estado de partidas") ──────────────────

/**
 * Para cada juego vivo, `lastSyncedHash` de este PC = huella de la copia MÁS
 * RECIENTE que hizo ESTE dispositivo (mismo orden que `listSaveBackups`:
 * reloj de sync, §12.5). Reglas:
 * - sin copia propia viva, no se toca el juego;
 * - si la más reciente no tiene huella (no se pudo calcular), tampoco: una
 *   anterior daría un linaje falso;
 * - nunca pisa una huella que ya exista (un backup o una restauración
 *   posteriores son más fiables que lo recuperado), así que es idempotente.
 * Devuelve cuántos juegos sembró.
 */
export function seedOwnLastSyncedHashes(ctx: QueryContext): number {
  const rows = ctx.db
    .select({ gameId: saveBackups.gameId, contentHash: saveBackups.contentHash })
    .from(saveBackups)
    .where(and(eq(saveBackups.deviceId, ctx.deviceId), liveRow.save_backups()))
    .orderBy(desc(saveBackups.syncCreated), desc(saveBackups.createdAt), desc(saveBackups.id))
    .all();
  const newest = new Map<string, string | null>();
  for (const row of rows) {
    if (!newest.has(row.gameId)) newest.set(row.gameId, row.contentHash);
  }
  return ctx.store.transaction(() => {
    let seeded = 0;
    for (const [gameId, hash] of newest) {
      if (hash === null || getLastSyncedHash(ctx, gameId) !== null) continue;
      setLastSyncedHash(ctx, gameId, hash);
      seeded++;
    }
    return seeded;
  });
}

// ── machine-saves.json → local_save_state (§19.6) ───────────────────────────

/**
 * Pasa los destinos de restauración que la 1.x guardaba por id numérico de
 * juego a `local_save_state`, con el id 2.0 que dejó el importador en
 * `local_legacy_ids`. NO vale recalcular el id: un juego con `igdbId` tiene un
 * id derivado del igdbId, no del id antiguo. Se ignoran los ids que no son
 * enteros positivos, los que el importador no conoce y los de juegos borrados.
 * No pisa un destino que ya exista. Devuelve cuántos movió.
 */
export function remapLegacyRestoreTargets(
  ctx: QueryContext,
  entries: readonly (readonly [string, string])[],
): number {
  let moved = 0;
  for (const [legacyId, target] of entries) {
    const numeric = Number(legacyId);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) continue;
    const mapped = ctx.db
      .select({ newId: localLegacyIds.newId })
      .from(localLegacyIds)
      .where(and(eq(localLegacyIds.legacyTable, 'games'), eq(localLegacyIds.legacyId, numeric)))
      .get();
    if (!mapped || !isLiveGame(ctx, mapped.newId)) continue;
    const existing = ctx.db
      .select({ target: localSaveState.restoreTarget })
      .from(localSaveState)
      .where(and(eq(localSaveState.gameId, mapped.newId), isNotNull(localSaveState.restoreTarget)))
      .get();
    if (existing) continue;
    setSaveRestoreTarget(ctx, mapped.newId, target);
    moved++;
  }
  return moved;
}

function isLiveGame(ctx: QueryContext, gameId: string): boolean {
  return (
    ctx.db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.id, gameId), liveGame()))
      .get() !== undefined
  );
}

// ── Carpeta de usuario de un dispositivo ────────────────────────────────────

/** `devices.home` del dispositivo, o null (no existe o no la conoce). */
export function getDeviceHome(ctx: QueryContext, deviceId: string): string | null {
  return (
    ctx.db.select({ home: devices.home }).from(devices).where(eq(devices.id, deviceId)).get()
      ?.home ?? null
  );
}
