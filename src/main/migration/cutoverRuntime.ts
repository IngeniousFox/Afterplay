// PUENTE 1.x → L3: se va con el orquestador (`cutover.ts`).
//
// El corte 1.x → 2.0 CABLEADO a la app: las dependencias reales del orquestador
// (Turso, importador, base, sync) y el estado que ven el IPC y la ventana. La
// lógica vive en `cutover.ts`; la marca de progreso y el disparador, en
// `cutoverProgress.ts`; aquí solo está lo que toca Electron.

import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CutoverAction, CutoverState } from '../../shared/cutover';
import {
  appCtx,
  appLocalDb,
  importLegacyForCutover,
  importSaveRestoreTargets,
} from '../db/v2/appDb';
import { migrateSecondaryLocal } from '../db/v2/importer/secondaryLocal';
import { copySourceConsistently, removeDatabaseFiles } from '../db/v2/importer/sourceCopy';
import { markSaveReindexPending, seedOwnLastSyncedHashes } from '../db/v2/queries/saves';
import { legacyDatabasePath, removeLocalDatabase } from '../db/v2/runtime';
import { getMachineId, getMachineName } from '../saves/machine';
import { appState } from '../bootstrap/appState';
import type { SyncRuntime } from '../sync/runtime';
import { forwardToWindow } from '../windows/forward';
import { CutoverController, type CutoverDeps, type CutoverSync } from './cutover';
import { createFileProgressStore } from './cutoverProgress';
import { readCutoverSyncProgress } from './cutoverSyncProgress';
import { openLegacyCutover } from './legacyCutover';
import { countLocalPendingChanges } from './legacyPending';

// ── Estado compartido con el IPC ────────────────────────────────────────────

let controller: CutoverController | null = null;
const sendState = forwardToWindow('cutover:state');

/** El estado actual: `idle` si no hay corte en este arranque. */
export const getCutoverState = (): CutoverState => controller?.state ?? { kind: 'idle' };

/** Una respuesta de la ventana (`cutover:action`). */
export const dispatchCutoverAction = (action: CutoverAction): void => {
  controller?.dispatch(action);
};

// ── Las dependencias reales ─────────────────────────────────────────────────

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-');

/** Secundario, tras bajar: ids, instalaciones, ubicaciones de restauración e índice de partidas. */
function migrateThisPcAsSecondary(userDataDir: string): void {
  const now = new Date();
  const backups = join(userDataDir, 'backups');
  mkdirSync(backups, { recursive: true });
  const copy = join(backups, `Afterplay-before-v2-${stamp(now)}.db`);
  const raw = `${copy}.raw`;
  try {
    copySourceConsistently(legacyDatabasePath(userDataDir), raw, copy);
    const report = migrateSecondaryLocal({
      source: copy,
      target: appLocalDb(),
      now: now.getTime(),
    });
    console.log(
      `[cutover] migración local: ${report.legacyIdsWritten} ids, ${report.installs.games} instalaciones de juegos, ` +
        `${report.installs.emulators} de emuladores, ${report.gamesNotInHub} juegos de la 1.x aún sin bajar`,
    );
  } catch (error) {
    removeDatabaseFiles(raw);
    throw error;
  }
  const ctx = appCtx();
  importSaveRestoreTargets(ctx);
  // Lo que ya bajó del hub se siembra ahora; el resto, cuando el reindexado
  // del bucket (que siempre se deja pendiente) recree las filas de este PC.
  const seeded = seedOwnLastSyncedHashes(ctx);
  if (seeded > 0) console.log(`[cutover] ${seeded} huella(s) de partidas sembradas`);
  markSaveReindexPending(ctx);
}

const syncAdapter = (): CutoverSync => {
  const runtime = (): SyncRuntime => {
    const current = appState.syncRuntime;
    if (!current) throw new Error('el sync todavía no está creado');
    return current;
  };
  return {
    isPaired: () => runtime().status().paired,
    start: () => runtime().start(0),
    pair: (request) => runtime().pair(request),
    pairWithSecret: (request) => runtime().pairWithSecret(request),
    requestEnrollSecret: () => runtime().requestEnrollSecret(),
    syncNow: () => runtime().syncNow(),
    progress: () => {
      const status = runtime().status();
      return readCutoverSyncProgress(
        appLocalDb().db,
        status.problem?.message ?? status.disabledReason,
      );
    },
  };
};

export interface RunCutoverOptions {
  /** Abre la base 2.0 y crea el sync de la app (idempotente). Lo pone el arranque. */
  readonly openDatabase: (mode: 'existing' | 'fresh') => void;
}

/**
 * Lleva el corte hasta el final. Resuelve cuando este PC ya puede enseñar la
 * biblioteca (la base está abierta y el sync creado). El estado va a la
 * ventana por `cutover:state`.
 */
export async function runCutover(options: RunCutoverOptions): Promise<void> {
  const userDataDir = app.getPath('userData');
  const deps: CutoverDeps = {
    self: {
      deviceId: getMachineId(),
      deviceName: getMachineName(),
      appVersion: app.getVersion(),
    },
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    progress: createFileProgressStore(userDataDir),
    openBridge: () => openLegacyCutover(),
    removeLocalDatabase: () => removeLocalDatabase(userDataDir),
    snapshotPath: () => {
      const backups = join(userDataDir, 'backups');
      mkdirSync(backups, { recursive: true });
      return join(backups, `Afterplay-remote-${stamp(new Date())}.db`);
    },
    removeSnapshot: (path) => removeDatabaseFiles(path),
    localPendingChanges: () =>
      countLocalPendingChanges(legacyDatabasePath(userDataDir), join(userDataDir, 'backups')),
    importLegacy: async (sourcePath) => {
      // La importación es síncrona y bloquea el proceso: se deja un turno para
      // que el estado `importing` llegue a la ventana antes.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      importLegacyForCutover(sourcePath ?? undefined);
    },
    openDatabase: options.openDatabase,
    afterImport: () => {
      const ctx = appCtx();
      // `save_backups` no se importa (§19.5): se reindexa desde el bucket.
      markSaveReindexPending(ctx);
      importSaveRestoreTargets(ctx);
    },
    migrateSecondaryLocal: () => migrateThisPcAsSecondary(userDataDir),
    sync: syncAdapter(),
  };
  controller = new CutoverController(deps);
  controller.onState((state) => sendState(state));
  await controller.run();
}
