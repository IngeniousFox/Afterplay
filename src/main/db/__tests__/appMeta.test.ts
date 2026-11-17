import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { publishDeviceStatus, readCutover, parseCutover, deviceStatusKey } from '../appMeta';
import { cleanupDbs, freshDb, type TestDb } from './harness';

// app_meta (puente 1.8, AFTERPLAY-2.0 §19.3.1): el contrato compartido con la
// 2.0. Base de verdad con las migraciones reales del repo — si la migración no
// crea la tabla con las columnas del contrato, esto cae.

let db: TestDb;

beforeEach(async () => {
  db = await freshDb();
});

after(() => cleanupDbs());

const rowsOf = (): Promise<{ key: string; value: string; updatedAt: number }[]> =>
  db.all(sql`SELECT key, value, updatedAt FROM app_meta ORDER BY key`);

describe('migración de app_meta', () => {
  it('crea la tabla con las columnas exactas del contrato', async () => {
    const columns = await db.all<{ name: string; type: string; notnull: number; pk: number }>(
      sql`SELECT name, type, "notnull", pk FROM pragma_table_info('app_meta') ORDER BY cid`,
    );
    assert.deepEqual(
      columns.map((column) => [column.name, column.type.toUpperCase(), column.notnull, column.pk]),
      [
        ['key', 'TEXT', 0, 1],
        ['value', 'TEXT', 1, 0],
        ['updatedAt', 'INTEGER', 1, 0],
      ],
    );
  });

  it('la reclamación del corte de la 2.0 (ON CONFLICT DO NOTHING) solo la gana uno', async () => {
    const claim = (deviceId: string): Promise<{ rowsAffected: number }> =>
      db.run(sql`
        INSERT INTO app_meta (key, value, updatedAt)
        VALUES ('cutover', ${JSON.stringify({ state: 'migrating', deviceId })}, 1)
        ON CONFLICT (key) DO NOTHING
      `) as Promise<{ rowsAffected: number }>;
    assert.equal((await claim('a')).rowsAffected, 1);
    assert.equal((await claim('b')).rowsAffected, 0);
  });
});

describe('readCutover', () => {
  it('sin fila no hay corte', async () => {
    assert.equal(await readCutover(db), null);
  });

  it('lee el estado migrating y done con sus datos', async () => {
    await db.run(sql`
      INSERT INTO app_meta (key, value, updatedAt) VALUES ('cutover', ${JSON.stringify({
        state: 'migrating',
        deviceId: 'pc-a',
        deviceName: 'PC A',
        appVersion: '2.0.0',
        at: 1_700_000_000_000,
      })}, 1)
    `);
    assert.deepEqual(await readCutover(db), {
      state: 'migrating',
      deviceId: 'pc-a',
      deviceName: 'PC A',
      appVersion: '2.0.0',
      at: 1_700_000_000_000,
    });

    await db.run(sql`UPDATE app_meta SET value = ${JSON.stringify({ state: 'done' })}`);
    assert.equal((await readCutover(db))?.state, 'done');
  });

  it('una fila ilegible sigue contando como corte (ante la duda, no se escribe)', () => {
    assert.equal(parseCutover('esto no es json').state, 'migrating');
    assert.equal(parseCutover('{"state":"otra"}').state, 'migrating');
    assert.equal(parseCutover('null').deviceId, null);
  });

  it('las claves device_status y hub no son un corte', async () => {
    await publishDeviceStatus(db, 'pc-a', {
      deviceName: 'PC A',
      appVersion: '1.8.0',
      lastPushOkAt: null,
      pendingChanges: 0,
      at: 5,
    });
    await db.run(
      sql`INSERT INTO app_meta (key, value, updatedAt) VALUES ('hub', '{"url":"x"}', 1)`,
    );
    assert.equal(await readCutover(db), null);
  });
});

describe('publishDeviceStatus', () => {
  const status = {
    deviceName: 'PC A',
    appVersion: '1.8.0',
    lastPushOkAt: 1_700_000_000_000,
    pendingChanges: 3,
    at: 1_700_000_060_000,
  };

  it('escribe device_status:<machineId> con la forma del contrato y updatedAt en ms', async () => {
    await publishDeviceStatus(db, 'pc-a', status);
    const rows = await rowsOf();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, deviceStatusKey('pc-a'));
    assert.equal(rows[0].key, 'device_status:pc-a');
    assert.equal(rows[0].updatedAt, status.at);
    assert.deepEqual(JSON.parse(rows[0].value), status);
  });

  it('lastPushOkAt puede ser null', async () => {
    await publishDeviceStatus(db, 'pc-a', { ...status, lastPushOkAt: null });
    const [row] = await rowsOf();
    assert.equal((JSON.parse(row.value) as { lastPushOkAt: unknown }).lastPushOkAt, null);
  });

  it('es un upsert: una fila por PC, la segunda llamada la actualiza', async () => {
    await publishDeviceStatus(db, 'pc-a', status);
    await publishDeviceStatus(db, 'pc-a', { ...status, pendingChanges: 0, at: status.at + 60_000 });
    await publishDeviceStatus(db, 'pc-b', status);
    const rows = await rowsOf();
    assert.deepEqual(
      rows.map((row) => row.key),
      ['device_status:pc-a', 'device_status:pc-b'],
    );
    assert.equal((JSON.parse(rows[0].value) as { pendingChanges: number }).pendingChanges, 0);
    assert.equal(rows[0].updatedAt, status.at + 60_000);
  });

  it('jamás toca cutover ni hub', async () => {
    await db.run(
      sql`INSERT INTO app_meta (key, value, updatedAt) VALUES ('cutover', '{"state":"done"}', 1)`,
    );
    await publishDeviceStatus(db, 'pc-a', status);
    const rows = await rowsOf();
    const cutover = rows.find((row) => row.key === 'cutover');
    assert.equal(cutover?.value, '{"state":"done"}');
    assert.equal(cutover?.updatedAt, 1);
    assert.equal(
      rows.some((row) => row.key === 'hub'),
      false,
    );
  });
});
