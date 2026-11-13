import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { syncedEntries } from '../registry';
import * as schema from '../schema';

// Barrera de la puerta única de escritura (§8.6).
//
// Si una escritura a una tabla sincronizada se salta `store/`, su cambio no
// lleva reloj ni `syncDirty`: no sube nunca, o sube con relojes viejos y
// pierde en la fusión. Este test recorre el código y falla si encuentra
// escrituras de Drizzle (`.insert(` / `.update(` / `.delete(`) o SQL de
// escritura crudo sobre tablas sincronizadas fuera de los sitios permitidos.
// Las tablas `local_*` sí se escriben desde cualquier parte.
//
// Es un análisis de texto, no de tipos: detecta los usos normales (el objeto
// de tabla del esquema, `x.table` de una entrada del registro, el nombre SQL
// en una cadena), no un objeto de tabla escondido tras una variable con otro
// nombre. Para eso se propone además una regla de ESLint que impida importar
// las tablas sincronizadas fuera de `src/main/db/v2` (ver el informe de la
// fase 2). Los tests (`__tests__`) no se recorren: preparan estados "llegados
// por sync" escribiendo a propósito por debajo de la puerta.

/** Carpetas que se recorren. Ampliar al migrar las consultas (`src/main/db/queries`…). */
const SCANNED = ['src/main/db/v2'];

/** Únicos sitios que pueden escribir tablas sincronizadas. */
const ALLOWED = ['src/main/db/v2/store', 'src/main/sync'];

const syncedSqlNames = new Set(syncedEntries.map((entry) => entry.name));

/** Nombres de exportación de las tablas sincronizadas (`games`, `gameMetadata`…). */
const syncedExportNames = new Set(
  Object.entries(schema)
    .filter(
      ([, value]) =>
        is(value, SQLiteTable) && syncedSqlNames.has(getTableConfig(value as SQLiteTable).name),
    )
    .map(([name]) => name),
);

const DRIZZLE_WRITE = /\.(insert|update|delete)\(\s*([^()]*?)\s*\)/g;
const SQL_WRITE =
  /\b(insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+[`"'[]?(\w+)/gi;

/** Quita comentarios (de forma sencilla) para no confundir prosa con SQL. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

function findWrites(code: string): string[] {
  const found: string[] = [];
  const source = stripComments(code);
  for (const match of source.matchAll(DRIZZLE_WRITE)) {
    const argument = match[2];
    const last = argument.split('.').pop() ?? '';
    const syncedObject = syncedExportNames.has(last);
    // `entry.table`, `registry.games.table`, `registry[name]…`: escrituras
    // genéricas sobre el registro, que solo puede hacer la puerta.
    const generic = /\btable\b|\bregistry\b/.test(argument);
    if (syncedObject || generic) found.push(`.${match[1]}(${argument})`);
  }
  for (const match of source.matchAll(SQL_WRITE)) {
    if (syncedSqlNames.has(match[2])) found.push(match[0].replace(/\s+/g, ' '));
  }
  return found;
}

const toPosix = (path: string): string => path.split(sep).join('/');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listFiles(path));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const isAllowed = (file: string): boolean =>
  ALLOWED.some((dir) => file === dir || file.startsWith(`${dir}/`));

describe('barrera de la puerta de escritura (§8.6)', () => {
  it('las carpetas recorridas existen', () => {
    for (const dir of SCANNED) assert.ok(existsSync(dir), dir);
  });

  it('nadie escribe tablas sincronizadas fuera de la puerta', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of SCANNED) {
      for (const path of listFiles(dir)) {
        const file = toPosix(relative('.', path));
        if (isAllowed(file)) continue;
        scanned += 1;
        for (const write of findWrites(readFileSync(path, 'utf8'))) {
          offenders.push(`${file}: ${write}`);
        }
      }
    }
    assert.ok(scanned > 0, 'no se ha recorrido ningún fichero');
    assert.deepEqual(offenders, []);
  });

  it('el detector distingue las escrituras prohibidas de las permitidas', () => {
    const bad = [
      'db.insert(games).values(x)',
      'db.update(schema.sessions).set({})',
      'tx.delete( playthroughs )',
      'db.update(entry.table).set(x)',
      'db.insert(registry.games.table)',
      "client.exec('UPDATE games SET notes = 1')",
      'db.run(sql`delete from "sessions" where 1`)',
      "client.prepare('INSERT OR REPLACE INTO `plan_entries` VALUES (?)')",
      "client.exec('replace into devices values (1)')",
    ];
    for (const code of bad) assert.equal(findWrites(code).length, 1, code);

    const good = [
      'db.insert(localSyncState).values({ id: 1 })',
      'db.update(schema.localJobState).set({})',
      "client.exec('UPDATE local_sync_state SET pullCursor = 0')",
      'this.listeners.delete(listener)',
      'seen.delete(key)',
      'db.select().from(games).where(eq(games.id, id))',
      '// update games: un comentario no es una escritura',
      '/* delete from sessions */',
    ];
    for (const code of good) assert.deepEqual(findWrites(code), [], code);
  });
});
