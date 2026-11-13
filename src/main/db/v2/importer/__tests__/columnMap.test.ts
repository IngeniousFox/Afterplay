import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as legacySchema from '../../../schema';
import { LEGACY_COLUMN_MAP } from '../columnMap';

// MAPA-1X.md ejecutable: cada columna del esquema 1.x tiene que estar
// declarada (va a, se transforma, se deriva o se descarta con motivo). Si
// alguien añade una columna a la 1.x o quita una del mapa, esto falla.

const legacyTables = Object.values(legacySchema)
  .filter((value) => is(value, SQLiteTable))
  .map((table) => getTableConfig(table as SQLiteTable));

describe('mapa de columnas 1.x → 2.0', () => {
  it('declara todas las tablas y columnas del esquema 1.x, y ninguna de más', () => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const config of legacyTables) {
      const decl = LEGACY_COLUMN_MAP[config.name];
      if (!decl) {
        missing.push(`${config.name} (tabla entera)`);
        continue;
      }
      const columns = config.columns.map((c) => c.name);
      for (const column of columns)
        if (!decl.columns[column]) missing.push(`${config.name}.${column}`);
      for (const column of Object.keys(decl.columns))
        if (!columns.includes(column)) extra.push(`${config.name}.${column}`);
    }
    const names = legacyTables.map((c) => c.name);
    for (const table of Object.keys(LEGACY_COLUMN_MAP))
      if (!names.includes(table)) extra.push(`${table} (tabla)`);
    assert.deepEqual(missing, [], 'columnas 1.x sin declarar');
    assert.deepEqual(extra, [], 'declaraciones que no son columnas 1.x');
    assert.ok(legacyTables.length >= 13);
  });

  it('lo que no se descarta dice cómo se comprueba, y lo descartado dice por qué', () => {
    for (const [table, decl] of Object.entries(LEGACY_COLUMN_MAP)) {
      for (const [column, c] of Object.entries(decl.columns)) {
        if (c.fate === 'dropped')
          assert.ok(c.to.length > 10, `${table}.${column}: falta el motivo`);
        else assert.ok(c.check, `${table}.${column}: ${c.fate} sin comprobación`);
      }
    }
  });
});
