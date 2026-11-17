import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { localEntries, syncedEntries } from '../../../src/main/db/v2/registry';
import { BOTTOM } from '../../../src/shared/sync/clock';
import { buildHubTables, ensureSchema, schemaFingerprint } from '../schema';
import { NodeSqlStorage } from '../node/nodeStorage';
import { T0, VERSION, clockAt, makeHub, pullAll, push, recordingStorage, wire } from './helpers';
import { TenantHub } from '../hub';

const columnsOf = (storage: NodeSqlStorage, table: string): string[] =>
  storage
    .exec(`PRAGMA table_info("${table}")`)
    .map((row) => String(row.name))
    .sort();

const A = 'aaaaaa';
const B = 'bbbbbb';

describe('el esquema del hub no se desvía del cliente', () => {
  it('tiene las tablas sincronizadas, las propias y las locales vacías', () => {
    const storage = new NodeSqlStorage();
    makeHub({}, storage);
    const tables = storage
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .map((row) => String(row.name));
    const synced = syncedEntries.map((entry) => entry.name);
    for (const name of synced) assert.ok(tables.includes(name), `falta ${name}`);
    // Las locales existen solo para que las consultas del escritorio corran en
    // el hub (§13.3): vacías, y con las columnas del cliente.
    for (const entry of localEntries) {
      assert.equal(storage.exec(`SELECT count(*) AS n FROM "${entry.name}"`)[0].n, 0, entry.name);
      const client = getTableConfig(entry.table).columns.map((column) => column.name);
      assert.deepEqual(columnsOf(storage, entry.name), [...client].sort(), entry.name);
    }
    const own = [
      'tenant_meta',
      'device_tokens',
      'device_short_ids',
      'enrollment_codes',
      'enrollment_secret',
      'job_leases',
    ];
    const locals = localEntries.map((entry) => entry.name);
    assert.deepEqual([...tables].sort(), [...synced, ...own, ...locals].sort());
  });

  it('cada tabla tiene las columnas del cliente y además syncSeq', () => {
    const storage = new NodeSqlStorage();
    makeHub({}, storage);
    for (const entry of syncedEntries) {
      const client = getTableConfig(entry.table).columns.map((column) => column.name);
      const expected = [...client, 'syncSeq'].sort();
      assert.deepEqual(columnsOf(storage, entry.name), expected, entry.name);
    }
  });

  it('el TableShape lista las columnas de datos y sus defectos en valores crudos', () => {
    const tables = new Map(buildHubTables().map((table) => [table.name, table]));
    for (const entry of syncedEntries) {
      const shape = tables.get(entry.name)!.shape;
      const data = getTableConfig(entry.table)
        .columns.map((column) => column.name)
        .filter((name) => !name.startsWith('sync') && name !== 'id');
      assert.deepEqual([...shape.columns].sort(), data.sort(), entry.name);
    }
    const games = tables.get('games')!.shape;
    assert.equal(games.defaults?.endless, 0);
    assert.equal(games.defaults?.saveBackupEnabled, 0);
    assert.equal(tables.get('sessions')!.shape.defaults?.source, 'measured');
    assert.equal(tables.get('achievement_catalogs')!.shape.defaults?.items, '[]');
    assert.equal(tables.get('achievement_unlocks')!.shape.defaults?.dateReliable, 1);
  });

  it('el hub no declara claves foráneas, restricciones CHECK ni índices del cliente', () => {
    const storage = new NodeSqlStorage();
    makeHub({}, storage);
    for (const entry of syncedEntries) {
      assert.deepEqual(storage.exec(`PRAGMA foreign_key_list("${entry.name}")`), [], entry.name);
      const sql = String(
        storage.exec(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
          entry.name,
        )[0].sql,
      );
      assert.ok(!/\bCHECK\s*\(|REFERENCES|FOREIGN/i.test(sql), entry.name);
      const indexes = storage
        .exec(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'`,
          entry.name,
        )
        .map((row) => String(row.name));
      assert.deepEqual(indexes, [`${entry.name}_sync_seq_idx`], entry.name);
    }
  });

  it('syncSeq es la única columna de más y está indexada para el pull', () => {
    const storage = new NodeSqlStorage();
    makeHub({}, storage);
    const plan = storage
      .exec(
        `EXPLAIN QUERY PLAN SELECT "syncSeq" FROM "games" WHERE "syncSeq" > ? ORDER BY "syncSeq" LIMIT ?`,
        0,
        10,
      )
      .map((row) => String(row.detail))
      .join('\n');
    assert.match(plan, /games_sync_seq_idx/);
  });
});

describe('migración aditiva al abrir', () => {
  it('es idempotente y no toca el esquema si la huella coincide', () => {
    const { storage } = makeHub();
    const recorded = recordingStorage(storage);
    ensureSchema(recorded.storage, buildHubTables());
    // Solo crea tenant_meta si falta y lee la huella: ninguna sentencia más.
    assert.deepEqual(
      recorded.statements.map((s) => s.sql),
      [`SELECT v FROM tenant_meta WHERE k = 'schemaStamp'`],
    );
    assert.equal(schemaFingerprint(buildHubTables()).length, 40);
  });

  it('añade las columnas que faltan con reloj BOTTOM en las filas existentes', () => {
    const test = makeHub();
    push(
      test.hub,
      wire({
        id: 'g1',
        at: clockAt(1, A),
        fields: { title: 'Hades', notes: 'viejas', endless: 1 },
      }),
    );
    // Un hub de una versión anterior no tenía `notes` ni `saveKey`.
    test.storage.exec(`ALTER TABLE games DROP COLUMN notes`);
    test.storage.exec(`ALTER TABLE games DROP COLUMN saveKey`);
    test.storage.exec(`DELETE FROM tenant_meta WHERE k = 'schemaStamp'`);
    assert.ok(!columnsOf(test.storage as NodeSqlStorage, 'games').includes('notes'));

    const reopened = new TenantHub(test.storage, () => T0, { tenantId: 'tenant1' });
    assert.ok(columnsOf(test.storage as NodeSqlStorage, 'games').includes('notes'));
    const [row] = pullAll(reopened);
    assert.equal(row.fields.title, 'Hades');
    assert.equal(row.fields.endless, 1);
    assert.equal(row.fields.notes, null);
    assert.equal(row.clocks.notes, BOTTOM);
    assert.equal(row.clocks.saveKey, BOTTOM);
    assert.equal(row.clocks.title, clockAt(1, A));
    // La migración no sube la secuencia: los clientes que ganan columnas empiezan de cero.
    assert.equal(reopened.status(VERSION).seq, 1);

    // La columna nueva no se queda con el valor por defecto frente a una escritura real.
    push(
      reopened,
      wire({
        id: 'g1',
        at: clockAt(2, B),
        fields: { notes: 'nuevas' },
        clocks: { notes: clockAt(2, B) },
      }),
    );
    assert.equal(pullAll(reopened)[0].fields.notes, 'nuevas');
  });

  it('crea una tabla que falta sin tocar las demás', () => {
    const test = makeHub();
    push(test.hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x' } }));
    test.storage.exec(`DROP TABLE radar_games`);
    test.storage.exec(`DELETE FROM tenant_meta WHERE k = 'schemaStamp'`);
    const reopened = new TenantHub(test.storage, () => T0, { tenantId: 'tenant1' });
    assert.equal(pullAll(reopened).length, 1);
    push(
      reopened,
      wire({ table: 'radar_games', id: 'igdb:1', at: clockAt(3, A), fields: { title: 'r' } }),
    );
    assert.equal(pullAll(reopened).length, 2);
  });

  it('un hub desplegado antes del secreto de alta gana su tabla sin perder nada', async () => {
    const test = makeHub();
    push(test.hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'Hades' } }));
    // El hub de antes: sin la tabla y con la huella vieja.
    test.storage.exec(`DROP TABLE enrollment_secret`);
    test.storage.exec(`DELETE FROM tenant_meta WHERE k = 'schemaStamp'`);
    const reopened = new TenantHub(test.storage, () => T0, { tenantId: 'tenant1' });
    assert.equal(pullAll(reopened).length, 1);
    assert.equal(reopened.status(VERSION).seq, 1);
    const { expiresAt } = await reopened.createEnrollmentSecret();
    assert.ok(expiresAt > T0);
  });
});
