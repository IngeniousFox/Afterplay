import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { syncedEntries, type SyncedTableName } from '../registry';
import type { ImportPlan } from './build';

// Escritura del plan en la base 2.0: "insertar si no existe".
//
// No pasa por `store.create` a propósito: la puerta pone el reloj de AHORA y
// lo importado tiene que llevar sus relojes antiguos y deterministas (§19.5).
// Por eso este módulo está en la lista de escritores permitidos del test de
// barrera (`__tests__/writeBarrier.test.ts`). Se ejecuta SIEMPRE dentro de la
// transacción de la puerta (`store.transaction`, ver index.ts), así que es
// atómico con la validación: si algo falla, no queda nada escrito.
//
// Nunca pisa una fila existente: puede haberse editado ya en la 2.0, y su
// reloj (posterior) ganaría igualmente en la fusión. Las ya presentes se
// cuentan, y se comparan con lo que se habría escrito para que el informe diga
// si son idénticas (una segunda ejecución) o distintas (editadas después).

/** Columnas que viajan (todas menos `syncDirty`, que es solo local). */
const isSyncedColumn = (column: string): boolean => column !== 'syncDirty';

/**
 * Columnas que la importación reescribe DESPUÉS de insertar, y que por eso no
 * cuentan al decidir si una fila ya presente es "distinta": la firma de los
 * recaps (`memorySignatures.ts`) pasa de ids 1.x a ids 2.0 en la primera
 * ejecución, y en la segunda el plan vuelve a traer la firma 1.x. Que quedó la
 * firma correcta lo comprueba la conciliación columna a columna.
 */
const rewrittenAfterInsert = (table: string, column: string): boolean =>
  table === 'generated_memories' && column === 'sourceHash';

export interface TargetTableCount {
  planned: number;
  inserted: number;
  alreadyPresent: number;
  alreadyPresentDifferent: number;
}

export function writePlan(
  client: DatabaseSync,
  plan: ImportPlan,
): Record<string, TargetTableCount> {
  const counts: Record<string, TargetTableCount> = {};
  // En el orden del registro: padre antes que hijo, por las claves foráneas.
  for (const entry of syncedEntries) {
    const name = entry.name as SyncedTableName;
    const rows = plan.rows.get(name) ?? [];
    const count: TargetTableCount = {
      planned: rows.length,
      inserted: 0,
      alreadyPresent: 0,
      alreadyPresentDifferent: 0,
    };
    counts[name] = count;
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0].values);
    const insert = client.prepare(
      `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) ` +
        `VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT ("id") DO NOTHING`,
    );
    const read = client.prepare(`SELECT * FROM "${name}" WHERE "id" = ?`);
    for (const row of rows) {
      const result = insert.run(...columns.map((c) => row.values[c] as SQLInputValue));
      if (Number(result.changes) === 1) {
        count.inserted += 1;
        continue;
      }
      count.alreadyPresent += 1;
      const existing = read.get(row.id) as Record<string, SQLInputValue> | undefined;
      const different =
        !existing ||
        columns.some(
          (c) =>
            isSyncedColumn(c) &&
            !rewrittenAfterInsert(name, c) &&
            (existing[c] ?? null) !== (row.values[c] ?? null),
        );
      if (different) count.alreadyPresentDifferent += 1;
    }
  }

  const mapInsert = client.prepare(
    'INSERT INTO "local_legacy_ids" ("legacyTable", "legacyId", "newId") VALUES (?, ?, ?) ' +
      'ON CONFLICT DO NOTHING',
  );
  const mapCount: TargetTableCount = {
    planned: plan.legacyIds.length,
    inserted: 0,
    alreadyPresent: 0,
    alreadyPresentDifferent: 0,
  };
  const mapRead = client.prepare(
    'SELECT "newId" FROM "local_legacy_ids" WHERE "legacyTable" = ? AND "legacyId" = ?',
  );
  for (const entry of plan.legacyIds) {
    const result = mapInsert.run(entry.legacyTable, entry.legacyId, entry.newId);
    if (Number(result.changes) === 1) {
      mapCount.inserted += 1;
      continue;
    }
    mapCount.alreadyPresent += 1;
    const existing = mapRead.get(entry.legacyTable, entry.legacyId) as
      { newId: string } | undefined;
    if (existing?.newId !== entry.newId) mapCount.alreadyPresentDifferent += 1;
  }
  counts.local_legacy_ids = mapCount;
  return counts;
}
