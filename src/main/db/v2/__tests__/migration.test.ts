import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync, type StatementResultingChanges } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { getTableName, is } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema';

// La migración de `drizzle-v2/` crea exactamente el esquema de `schema.ts`.
// Si alguien cambia el esquema sin regenerar (`npm run db:v2:generate`), falla
// aquí. Se aplica el SQL tal cual lo leería el migrador de Drizzle, sobre una
// base vacía en memoria con `node:sqlite`, el driver de la 2.0 (§8.9).

const MIGRATIONS_FOLDER = 'drizzle-v2';

const schemaTables = Object.values<unknown>(schema).filter((value): value is SQLiteTable =>
  is(value, SQLiteTable),
);

type TableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
type IndexListRow = { name: string; unique: number; origin: string; partial: number };
type IndexInfoRow = { name: string };
type ForeignKeyRow = {
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
};

let db: DatabaseSync;

before(() => {
  db = new DatabaseSync(':memory:');
  for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })) {
    for (const statement of migration.sql) {
      if (statement.trim()) db.exec(statement);
    }
  }
});

after(() => db.close());

const all = <T>(query: string): T[] => db.prepare(query).all() as T[];

describe('migración 2.0', () => {
  it('hay una sola migración inicial hasta que la 2.0 se publique', () => {
    const folders = readdirSync(MIGRATIONS_FOLDER, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    assert.equal(folders.length, 1, folders.map((folder) => folder.name).join(', '));
  });

  it('crea exactamente las tablas del esquema', () => {
    const tables = all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).map((row) => row.name);
    assert.deepEqual(tables.sort(), schemaTables.map((table) => getTableName(table)).sort());
  });

  for (const table of schemaTables) {
    const config = getTableConfig(table);
    const name = config.name;

    it(`${name}: columnas, tipos, NOT NULL, DEFAULT y clave primaria`, () => {
      const pkColumns = new Set([
        ...config.columns.filter((column) => column.primary).map((column) => column.name),
        ...config.primaryKeys.flatMap((pk) => pk.columns.map((column) => column.name)),
      ]);
      const expected = config.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType(),
        notNull: column.notNull,
        hasDefault: column.default !== undefined,
        pk: pkColumns.has(column.name),
      }));
      const actual = all<TableInfoRow>(`PRAGMA table_info(\`${name}\`)`).map((row) => ({
        name: row.name,
        type: row.type.toLowerCase(),
        // SQLite no marca notnull en una INTEGER PRIMARY KEY porque es el
        // rowid y nunca es null; Drizzle sí. Para el resto, tal cual (y en
        // una clave TEXT el NOT NULL es real: ver `textPrimaryKey`).
        notNull: row.notnull === 1 || (row.pk > 0 && row.type.toLowerCase() === 'integer'),
        hasDefault: row.dflt_value !== null,
        pk: row.pk > 0,
      }));
      assert.deepEqual(actual, expected);
    });

    it(`${name}: índices`, () => {
      const expected = config.indexes
        .map((idx) => ({
          name: idx.config.name,
          columns: idx.config.columns.map((column) => ('name' in column ? column.name : '?')),
          unique: Boolean(idx.config.unique),
          partial: idx.config.where !== undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const actual = all<IndexListRow>(`PRAGMA index_list(\`${name}\`)`)
        // Los índices automáticos de la clave primaria no se declaran.
        .filter((row) => row.origin === 'c')
        .map((row) => ({
          name: row.name,
          columns: all<IndexInfoRow>(`PRAGMA index_info(\`${row.name}\`)`).map((col) => col.name),
          unique: row.unique === 1,
          partial: row.partial === 1,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(actual, expected);
    });

    it(`${name}: claves foráneas, todas sin acciones`, () => {
      const expected = config.foreignKeys
        .map((fk) => {
          const reference = fk.reference();
          return {
            from: reference.columns[0].name,
            table: getTableName(reference.foreignTable),
            to: reference.foreignColumns[0].name,
          };
        })
        .sort((a, b) => a.from.localeCompare(b.from));
      const rows = all<ForeignKeyRow>(`PRAGMA foreign_key_list(\`${name}\`)`);
      const actual = rows
        .map((row) => ({ from: row.from, table: row.table, to: row.to }))
        .sort((a, b) => a.from.localeCompare(b.from));
      assert.deepEqual(actual, expected);
      for (const row of rows) {
        assert.equal(row.on_delete, 'NO ACTION', `${name}.${row.from}: ON DELETE`);
        assert.equal(row.on_update, 'NO ACTION', `${name}.${row.from}: ON UPDATE`);
      }
    });

    it(`${name}: restricciones CHECK`, () => {
      const [{ sql }] = all<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`,
      );
      const declared = (sql.match(/CONSTRAINT\s+"([^"]+)"\s+CHECK/g) ?? []).map(
        (match) => /"([^"]+)"/.exec(match)?.[1],
      );
      assert.deepEqual(declared.sort(), config.checks.map((chk) => chk.name).sort());
    });
  }
});

describe('restricciones de la base 2.0', () => {
  const CLOCK = '1763020800123-0000-a1b2c3';

  const insertBase = (): void => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(
      'DELETE FROM sessions; DELETE FROM playthroughs; DELETE FROM games; DELETE FROM devices',
    );
    db.prepare(
      `INSERT INTO devices (id, syncCreated, syncUpdated, name, kind, os, firstSeenAt)
       VALUES ('dev-a', ?, ?, 'PC-A', 'desktop', 'windows', 0)`,
    ).run(CLOCK, CLOCK);
    db.prepare(
      `INSERT INTO games (id, syncCreated, syncUpdated, title, addedAt)
       VALUES ('game-1', ?, ?, 'Celeste', 0)`,
    ).run(CLOCK, CLOCK);
    db.prepare(
      `INSERT INTO playthroughs (id, syncCreated, syncUpdated, gameId, playedPlatform, origin)
       VALUES ('pt-1', ?, ?, 'game-1', 'PC', 'Steam')`,
    ).run(CLOCK, CLOCK);
  };

  const insertSession = (
    id: string,
    playthroughId: string | null,
    emulatorId: string | null,
  ): StatementResultingChanges =>
    db
      .prepare(
        `INSERT INTO sessions (id, syncCreated, syncUpdated, playthroughId, emulatorId, deviceId,
           startedBy, startedAt, datePrecision)
         VALUES (?, ?, ?, ?, ?, 'dev-a', 'watcher', 0, 'datetime')`,
      )
      .run(id, CLOCK, CLOCK, playthroughId, emulatorId);

  it('las columnas de sync toman sus valores por defecto', () => {
    insertBase();
    const row = db
      .prepare("SELECT syncFields, syncDirty, syncDeleted FROM games WHERE id = 'game-1'")
      .get();
    assert.deepEqual({ ...row }, { syncFields: '{}', syncDirty: 0, syncDeleted: null });
  });

  it('una sesión necesita playthroughId o emulatorId', () => {
    insertBase();
    assert.throws(() => insertSession('s-0', null, null), /CHECK constraint failed/);
    insertSession('s-1', 'pt-1', null);
  });

  it('el CHECK de sesiones se puede desactivar durante la descarga', () => {
    insertBase();
    db.exec('PRAGMA ignore_check_constraints = ON');
    try {
      insertSession('s-2', null, null);
    } finally {
      db.exec('PRAGMA ignore_check_constraints = OFF');
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE id = 's-2'").get()?.n, 1);
  });

  it('el id de una tabla sincronizada no admite null', () => {
    insertBase();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO games (id, syncCreated, syncUpdated, title, addedAt) VALUES (NULL, ?, ?, 'x', 0)`,
          )
          .run(CLOCK, CLOCK),
      /NOT NULL constraint failed/,
    );
  });

  it('las claves foráneas se comprueban y no borran en cascada', () => {
    insertBase();
    db.exec('PRAGMA foreign_keys = ON');
    try {
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO playthroughs (id, syncCreated, syncUpdated, gameId, playedPlatform, origin)
               VALUES ('pt-huerfano', ?, ?, 'no-existe', 'PC', 'Steam')`,
            )
            .run(CLOCK, CLOCK),
        /FOREIGN KEY constraint failed/,
      );
      // Un borrado físico del padre no arrastra a los hijos: falla. En la 2.0
      // no se borra físicamente; se pone la lápida.
      assert.throws(() => db.exec("DELETE FROM games WHERE id = 'game-1'"), /FOREIGN KEY/);
      assert.equal(db.prepare('SELECT count(*) AS n FROM playthroughs').get()?.n, 1);
    } finally {
      db.exec('PRAGMA foreign_keys = OFF');
    }
  });

  it('local_sync_state tiene una sola fila', () => {
    db.exec('INSERT INTO local_sync_state (id) VALUES (1)');
    assert.throws(() => db.exec('INSERT INTO local_sync_state (id) VALUES (2)'), /CHECK/);
  });
});
