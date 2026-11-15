// Andamio de los escenarios de partidas (§12, E-16..E-20) sobre el arnés de
// convergencia. Solo prepara datos: todo lo que se comprueba pasa por las
// consultas reales de `src/main/db/v2/queries/saves` y por `computeSaveSyncState`.

import { createHash } from 'node:crypto';
import { computeContentHash } from '../../src/main/saves/contentHash';
import {
  computeSaveSyncState,
  type LocalSave,
  type SaveSyncState,
} from '../../src/main/saves/syncState';
import {
  ensureSaveKey,
  getLastSyncedHash,
  listSaveBackups,
  listSaveLineage,
  reconcileOwnSaveBackups,
  saveMaintenanceForeignWriteRule,
  saveObjectKey,
  type NewOwnSaveBackup,
  type ReconcileOwnSaveBackupsResult,
} from '../../src/main/db/v2/queries/saves';
import type { ForeignWriteRule } from '../../src/main/db/v2/store';
import type { Client } from './harness';

/** Huella de una partida inventada: el mismo texto da siempre la misma huella. */
export function hashOf(label: string): string {
  const sha1 = createHash('sha1').update(label).digest('hex');
  const hash = computeContentHash({
    files: [{ path: 'C:/Users/ana/Saves/slot1.sav', hash: sha1 }],
    registryHash: null,
    home: 'C:/Users/ana',
  });
  if (hash === null) throw new Error('la huella inventada no debería ser null');
  return hash;
}

/** Una versión propia que acaba de subirse al bucket, con la huella de `label`. */
export function version(
  backupName: string,
  label: string | null,
  createdAt: Date,
): NewOwnSaveBackup {
  return {
    backupName,
    createdAt,
    sizeBytes: 1024,
    ludusaviName: 'Juego inventado',
    differential: false,
    parentBackupName: null,
    locations: null,
    hasRegistry: false,
    contentHash: label === null ? null : hashOf(label),
  };
}

/** El `saveKey` del juego en este cliente (lo fija el alta; `ensureSaveKey` es idempotente). */
export function saveKeyOf(client: Client, gameId: string): string {
  const key = ensureSaveKey(client.ctx, gameId);
  if (key === null) throw new Error(`el juego ${gameId} no existe en ${client.name}`);
  return key;
}

/** La clave del objeto en el bucket de una versión de ESTE cliente. */
export function keyOf(client: Client, gameId: string, backupName: string): string {
  return saveObjectKey({
    saveKey: saveKeyOf(client, gameId),
    deviceId: client.deviceId,
    backupName,
  });
}

/**
 * Lo que hace el espejo tras subir al bucket: indexa las versiones de ESTE PC.
 * `isStale` por defecto: nada caduca.
 */
export function uploadVersions(
  client: Client,
  gameId: string,
  versions: readonly NewOwnSaveBackup[],
  isStale: (row: { backupName: string }) => boolean = () => false,
): ReconcileOwnSaveBackupsResult {
  return reconcileOwnSaveBackups(client.ctx, {
    gameId,
    saveKey: saveKeyOf(client, gameId),
    isStale,
    versions,
  });
}

/** El estado de la ficha de `gameId` en este cliente (§12.4), con `local` como disco. */
export function stateOf(client: Client, gameId: string, local: LocalSave): SaveSyncState {
  return computeSaveSyncState({
    rows: listSaveLineage(client.ctx, gameId),
    local,
    lastSynced: getLastSyncedHash(client.ctx, gameId),
    selfDeviceId: client.deviceId,
  });
}

export const onDisk = (label: string): LocalSave => ({ kind: 'hash', hash: hashOf(label) });
export const EMPTY_DISK: LocalSave = { kind: 'empty' };

/** Filas VIVAS del índice del juego por nombre de copia (de todos los dispositivos). */
export function liveBackupNames(client: Client, gameId: string): string[] {
  return listSaveBackups(client.ctx, gameId)
    .map((row) => row.backupName)
    .sort();
}

/**
 * Registra la regla de R-13 (`saveMaintenanceForeignWriteRule`) en la puerta de
 * escritura de este cliente. La app real la registra al abrir la base
 * (`runtime.ts`), pero el arnés abre las bases sin ella, y el borrado cruzado y
 * la recuperación de filas ajenas la necesitan.
 *
 * El almacén guarda las reglas en un campo privado de solo lectura y no tiene
 * API para añadirlas después de abrir; como esto es solo andamio de tests, se
 * reasigna ese campo con un cast estrecho en vez de tocar código de producción.
 */
export function registerSaveMaintenanceRule(client: Client): void {
  const store = client.local.store as unknown as { rules: readonly ForeignWriteRule[] };
  if (!store.rules.includes(saveMaintenanceForeignWriteRule)) {
    store.rules = [...store.rules, saveMaintenanceForeignWriteRule];
  }
}
