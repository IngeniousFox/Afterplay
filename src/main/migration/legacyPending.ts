// PUENTE 1.x → L3: se va con el orquestador (`cutover.ts`).
//
// ¿Cuántos cambios de la 1.x de ESTE PC no llegaron nunca a Turso? La réplica
// local de Turso apunta cada escritura en una cola CDC (`turso_cdc`) y recuerda
// hasta cuál subió (`turso_sync_last_change_id`). Lo que queda por encima de esa
// marca se perdería si el corte importa desde el remoto (§19.5), así que el
// orquestador lo pregunta antes.
//
// Se mira en una COPIA consistente (`copySourceConsistently`), nunca en la base
// en uso. Los nombres de las tablas y columnas del replicador no son contrato
// público, así que todo es defensivo: si algo no cuadra se devuelve null ("no se
// puede saber") y el orquestador se queda con lo que diga `device_status`.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { copySourceConsistently, removeDatabaseFiles } from '../db/v2/importer/sourceCopy';

const CDC_TABLE = 'turso_cdc';
const MARK_TABLE = 'turso_sync_last_change_id';
const MARK_COLUMNS = ['change_id', 'last_change_id', 'id'];

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

/** Cuenta las filas de la cola CDC por encima de la marca de lo ya subido (null si no se sabe). */
export function pendingChangesIn(db: DatabaseSync): number | null {
  const tables = new Set(
    (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((t) => t.name),
  );
  if (!tables.has(CDC_TABLE)) return null;
  if (!columnsOf(db, CDC_TABLE).includes('change_id')) return null;
  if (!tables.has(MARK_TABLE)) {
    // Sin marca de lo subido, la cola entera sigue pendiente.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${CDC_TABLE}"`).get() as { n: number };
    return Number(row.n);
  }
  const markColumn = MARK_COLUMNS.find((c) => columnsOf(db, MARK_TABLE).includes(c));
  if (!markColumn) return null;
  const mark = db.prepare(`SELECT MAX("${markColumn}") AS m FROM "${MARK_TABLE}"`).get() as {
    m: number | bigint | null;
  };
  const last = mark.m === null ? 0 : Number(mark.m);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "${CDC_TABLE}" WHERE change_id > ?`)
    .get(last) as { n: number };
  return Number(row.n);
}

/**
 * Los cambios sin subir de la base 1.x de `legacyPath` (la réplica de este PC),
 * o null si no se puede saber. No la abre: trabaja sobre una copia temporal
 * dentro de `scratchDir` (backups/), que se borra al terminar.
 */
export async function countLocalPendingChanges(
  legacyPath: string,
  scratchDir: string,
): Promise<number | null> {
  const copy = join(scratchDir, 'Afterplay-pending-check.tmp.db');
  try {
    mkdirSync(scratchDir, { recursive: true });
    removeDatabaseFiles(copy);
    copySourceConsistently(legacyPath, `${copy}.raw`, copy);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return pendingChangesIn(db);
    } finally {
      db.close();
    }
  } catch {
    return null;
  } finally {
    removeDatabaseFiles(copy);
  }
}
