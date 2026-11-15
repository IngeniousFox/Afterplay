// Un hub "del futuro" para E-14: el esquema 2 del hub tiene una columna y una
// tabla sincronizadas que los clientes de este build NO conocen. Es lo que
// ocurre cuando se despliega el hub primero (§8.7) y algún PC aún no se ha
// actualizado.
//
// Se construye a mano sobre `buildHubTables()` porque el cliente no tiene
// ningún seam para inyectar formas de tabla (`syncTables` sale del registro);
// el hub sí acepta `tables` (HubOptions), pensado justo para los tests.

import { buildHubTables, type HubTable, type HubTableColumn } from '../core/schema';

const quote = (name: string): string => `"${name}"`;

/** Reconstruye el UPSERT igual que `buildTable` de `hub/core/schema.ts`. */
function upsertFor(name: string, upsertColumns: string[]): string {
  const insertColumns = ['id', ...upsertColumns];
  return (
    `INSERT INTO ${quote(name)} (${insertColumns.map(quote).join(', ')}) ` +
    `VALUES (${insertColumns.map(() => '?').join(', ')}) ` +
    `ON CONFLICT("id") DO UPDATE SET ${upsertColumns.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(', ')}`
  );
}

function withColumn(table: HubTable, column: HubTableColumn): HubTable {
  const upsertColumns = [...table.upsertColumns, column.name];
  return {
    ...table,
    dataColumns: [...table.dataColumns, column],
    shape: { ...table.shape, columns: [...table.shape.columns, column.name] },
    createSql: table.createSql.replace(/\n\);$/, `,\n  ${quote(column.name)} TEXT\n);`),
    upsertColumns,
    upsertSql: upsertFor(table.name, upsertColumns),
  };
}

function newTable(name: string, columns: string[]): HubTable {
  const dataColumns: HubTableColumn[] = columns.map((c) => ({
    name: c,
    type: 'text',
    defaultSql: null,
  }));
  const upsertColumns = [
    'syncCreated',
    'syncUpdated',
    'syncFields',
    'syncDeleted',
    'syncSeq',
    ...columns,
  ];
  return {
    name,
    shape: { columns, defaults: {} },
    dataColumns,
    createSql:
      `CREATE TABLE IF NOT EXISTS ${quote(name)} (\n  "id" TEXT PRIMARY KEY NOT NULL,\n  "syncCreated" TEXT NOT NULL,\n` +
      `  "syncUpdated" TEXT NOT NULL,\n  "syncFields" TEXT NOT NULL DEFAULT '{}',\n  "syncDeleted" TEXT,\n  "syncSeq" INTEGER,\n` +
      `  ${columns.map((c) => `${quote(c)} TEXT`).join(',\n  ')}\n);`,
    indexSql: `CREATE INDEX IF NOT EXISTS ${quote(`${name}_sync_seq_idx`)} ON ${quote(name)} ("syncSeq") WHERE "syncSeq" IS NOT NULL;`,
    upsertSql: upsertFor(name, upsertColumns),
    upsertColumns,
  };
}

export const FUTURE_COLUMN = 'futureNote';
export const FUTURE_TABLE = 'future_things';

/** Las tablas del hub 2.0 más `games.futureNote` y la tabla `future_things(label)`. */
export function futureHubTables(): HubTable[] {
  const tables = buildHubTables().map((table) =>
    table.name === 'games'
      ? withColumn(table, { name: FUTURE_COLUMN, type: 'text', defaultSql: null })
      : table,
  );
  return [...tables, newTable(FUTURE_TABLE, ['label'])];
}
