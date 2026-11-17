import type { LocalDb } from '../db/v2/store';
import type { CutoverSyncProgress } from './cutover';
import { readSyncState } from '../sync/state';
import { syncTables } from '../sync/tables';

// PUENTE 1.x → L3: lo que el orquestador del corte (`migration/cutover.ts`)
// necesita mirar del sync, sin tocarlo (§19.7).
//
// No marca nada como pendiente: al emparejar con un hub que este PC no
// conoce, el primer ciclo del motor marca TODAS las filas (`checkIdentity`) y
// las sube por el camino normal. Aquí solo se cuenta. Mientras el motor no ha
// hablado con el hub (`hubId` vacío) todavía no hay `syncDirty` que mirar: se
// toman todas las filas como pendientes, que es lo que van a ser.

/** Filas de las tablas sincronizadas y cuántas están pendientes de subir. */
export function countSyncRows(db: LocalDb): { total: number; dirty: number } {
  let total = 0;
  let dirty = 0;
  for (const table of syncTables) {
    const row = db.$client
      .prepare(
        `SELECT count(*) AS total, coalesce(sum("syncDirty"), 0) AS dirty FROM "${table.name}"`,
      )
      .get() as { total: number; dirty: number };
    total += Number(row.total);
    dirty += Number(row.dirty);
  }
  return { total, dirty };
}

export function readCutoverSyncProgress(db: LocalDb, problem: string | null): CutoverSyncProgress {
  const state = readSyncState(db);
  const { total, dirty } = countSyncRows(db);
  const hubKnown = state.hubId !== null;
  return {
    hubKnown,
    rowsPending: hubKnown ? dirty : total,
    rowsLocal: total,
    pulled: hubKnown && state.lastPullAt !== null,
    problem,
  };
}
