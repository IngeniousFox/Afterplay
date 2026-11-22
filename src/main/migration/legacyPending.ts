// PUENTE 1.x → L3: se va con el orquestador (`cutover.ts`).
//
// ¿Quedan en la réplica local de ESTE PC cambios de la 1.x que nunca llegaron a
// Turso? La réplica apunta cada escritura en una cola CDC (`turso_cdc`), que el
// replicador vacía tras cada subida. Lo que siga en ella se perdería si el corte
// importa desde el remoto (§19.5), así que el orquestador lo pregunta antes.
//
// Qué cuenta (corregido el 2026-11-22, con la cola de una réplica real):
//  - Solo filas de datos. Las marcas de fin de transacción (`table_name` nulo) no
//    son cambios.
//  - Nunca la contabilidad del propio sync: la marca de lo subido
//    (`turso_sync_last_change_id`, que el replicador reescribe al subir) ni el
//    `device_status:*` que la 1.8 publica en cada ciclo. Están SIEMPRE en la cola,
//    así que contarlos hacía que todo PC pareciera tener cambios sin subir.
//  - No se compara con `turso_sync_last_change_id`: esa tabla guarda una marca
//    por cada cliente que ha tenido la réplica y sus números no son de la cola
//    actual (una marca vieja de 22.373 frente a una cola que empezaba en 1), así
//    que la marca más alta escondía cambios de verdad. Contar la cola entera
//    puede pasarse, nunca quedarse corto.
//
// Se mira en una COPIA consistente (`copySourceConsistently`), nunca en la base
// en uso. Los nombres del replicador no son contrato público, así que todo es
// defensivo: si algo no cuadra se devuelve null ("no se puede saber") y el
// orquestador se queda con lo que diga `device_status`.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { copySourceConsistently, removeDatabaseFiles } from '../db/v2/importer/sourceCopy';

const CDC_TABLE = 'turso_cdc';
const SYNC_TABLE_PREFIX = 'turso_';
const META_TABLE = 'app_meta';
const STATUS_KEY_PREFIX = 'device_status:';

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

/** Cuenta los cambios de datos que siguen en la cola CDC (null si no se sabe). */
export function pendingChangesIn(db: DatabaseSync): number | null {
  const tables = new Set(
    (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((t) => t.name),
  );
  if (!tables.has(CDC_TABLE)) return null;
  const cdcColumns = columnsOf(db, CDC_TABLE);
  if (!['change_id', 'table_name', 'id'].every((c) => cdcColumns.includes(c))) return null;

  const rows = db
    .prepare(`SELECT table_name AS t, id FROM "${CDC_TABLE}" WHERE table_name IS NOT NULL`)
    .all() as { t: string; id: number | bigint | null }[];
  const metaKey =
    tables.has(META_TABLE) && columnsOf(db, META_TABLE).includes('key')
      ? db.prepare(`SELECT key FROM "${META_TABLE}" WHERE rowid = ?`)
      : null;

  let pending = 0;
  for (const row of rows) {
    if (row.t.startsWith(SYNC_TABLE_PREFIX)) continue;
    if (row.t === META_TABLE && metaKey && row.id !== null) {
      const meta = metaKey.get(row.id) as { key: string } | undefined;
      if (meta?.key.startsWith(STATUS_KEY_PREFIX)) continue;
    }
    pending += 1;
  }
  return pending;
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
