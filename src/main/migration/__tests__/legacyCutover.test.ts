import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import {
  createLegacyCutover,
  effectivePendingChanges,
  findLaggingDevices,
  SAME_CYCLE_MS,
  LegacyCutoverError,
  openLegacyCutover,
  type DeviceStatus,
  type HubEnrollment,
  type LegacyCutover,
} from '../legacyCutover';

// Turso queda sustituido por un fichero `file:` con la tabla del §19.3.1.
// Todo con datos inventados.

const T0 = 1_763_380_800_000;
const PC_A = { deviceId: 'machine-a', deviceName: 'PC-A', appVersion: '2.0.0' };
const PC_B = { deviceId: 'machine-b', deviceName: 'PC-B', appVersion: '2.0.0' };
const HUB: HubEnrollment = {
  url: 'https://hub.example.test',
  enrollSecret: 'secreto-de-prueba',
  expiresAt: T0 + 7 * 86_400_000,
};

const CREATE_APP_META = `CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
)`;

const put = (client: Client, key: string, value: string): Promise<ResultSet> =>
  client.execute({
    sql: 'INSERT INTO app_meta (key, value, updatedAt) VALUES (?, ?, ?)',
    args: [key, value, T0],
  });

const status = (over: Partial<DeviceStatus> = {}): DeviceStatus => ({
  deviceId: 'machine-b',
  deviceName: 'PC-B',
  appVersion: '1.8.0',
  lastPushOkAt: T0,
  pendingChanges: 0,
  at: T0,
  seenCutoverAt: T0,
  ...over,
});

describe('puente del corte 1.x (legacyCutover)', () => {
  let dir: string;
  let url: string;
  let clients: Client[];
  let bridge: LegacyCutover;
  let raw: Client;

  const open = (): Client => {
    const client = createClient({ url });
    clients.push(client);
    return client;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'afterplay-cutover-'));
    url = pathToFileURL(join(dir, 'turso.db')).href;
    clients = [];
    raw = open();
    await raw.execute(CREATE_APP_META);
    bridge = createLegacyCutover(open(), () => T0);
  });

  afterEach(() => {
    for (const client of clients) client.close();
    // En Windows libsql tarda en soltar el fichero (EBUSY): se deja a
    // scripts/clean-test-temp.ts, que barre este prefijo antes y después.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
    }
  });

  it('readCutover es null sin fila y devuelve el valor parseado con ella', async () => {
    assert.equal(await bridge.readCutover(), null);
    await bridge.claimCutover(PC_A);
    assert.deepEqual(await bridge.readCutover(), { state: 'migrating', ...PC_A, at: T0 });
  });

  it('claim: gana el primero, repite como already-mine y el otro pierde con el titular', async () => {
    assert.deepEqual(await bridge.claimCutover(PC_A), { outcome: 'won' });
    assert.deepEqual(await bridge.claimCutover(PC_A), { outcome: 'already-mine' });
    const lost = await bridge.claimCutover(PC_B);
    assert.equal(lost.outcome, 'lost');
    assert.ok(lost.outcome === 'lost');
    assert.equal(lost.holder.deviceName, 'PC-A');
    assert.equal(lost.holder.state, 'migrating');
  });

  it('claim: con el corte ya hecho, ni el propio PC lo vuelve a reclamar', async () => {
    await bridge.claimCutover(PC_A);
    await bridge.completeCutover(PC_A.deviceId, HUB);
    const again = await bridge.claimCutover(PC_A);
    assert.equal(again.outcome, 'lost');
    assert.ok(again.outcome === 'lost');
    assert.equal(again.holder.state, 'done');
  });

  it('dos reclamos simultáneos desde dos conexiones: gana exactamente uno', async () => {
    const one = createLegacyCutover(open(), () => T0);
    const two = createLegacyCutover(open(), () => T0);
    const results = await Promise.all([one.claimCutover(PC_A), two.claimCutover(PC_B)]);
    assert.equal(results.filter((r) => r.outcome === 'won').length, 1);
    assert.equal(results.filter((r) => r.outcome === 'lost').length, 1);
    const rows = await raw.execute("SELECT count(*) AS n FROM app_meta WHERE key = 'cutover'");
    assert.equal(Number(rows.rows[0].n), 1);
  });

  it('release solo borra el migrating de este PC', async () => {
    await bridge.claimCutover(PC_A);
    assert.equal(await bridge.releaseCutover(PC_B.deviceId), false);
    assert.notEqual(await bridge.readCutover(), null);
    assert.equal(await bridge.releaseCutover(PC_A.deviceId), true);
    assert.equal(await bridge.readCutover(), null);
    // Tras soltar, otro puede reclamar.
    assert.deepEqual(await bridge.claimCutover(PC_B), { outcome: 'won' });
  });

  it('release no toca un corte ya terminado, ni el propio', async () => {
    await bridge.claimCutover(PC_A);
    await bridge.completeCutover(PC_A.deviceId, HUB);
    assert.equal(await bridge.releaseCutover(PC_A.deviceId), false);
    assert.equal((await bridge.readCutover())?.state, 'done');
  });

  it('complete: pasa a done y escribe el hub en una sola operación', async () => {
    await bridge.claimCutover(PC_A);
    await bridge.completeCutover(PC_A.deviceId, HUB);
    const cutover = await bridge.readCutover();
    assert.equal(cutover?.state, 'done');
    assert.equal(cutover?.deviceId, PC_A.deviceId);
    assert.deepEqual(await bridge.readHubEnrollment(), HUB);
  });

  it('complete: rechaza un migrating ajeno, uno ya done y la falta de fila, sin escribir hub', async () => {
    await assert.rejects(bridge.completeCutover(PC_A.deviceId, HUB), {
      code: 'not-owner',
    });
    await bridge.claimCutover(PC_B);
    await assert.rejects(bridge.completeCutover(PC_A.deviceId, HUB), { code: 'not-owner' });
    assert.equal((await bridge.readCutover())?.state, 'migrating');
    await bridge.completeCutover(PC_B.deviceId, HUB);
    await assert.rejects(bridge.completeCutover(PC_B.deviceId, { ...HUB, enrollSecret: 'otro' }), {
      code: 'not-owner',
    });
    assert.deepEqual(await bridge.readHubEnrollment(), HUB);
    const hubRows = await raw.execute("SELECT count(*) AS n FROM app_meta WHERE key = 'hub'");
    assert.equal(Number(hubRows.rows[0].n), 1);
  });

  it('el hub solo se entrega con cutover = done', async () => {
    assert.equal(await bridge.readHubEnrollment(), null);
    await bridge.claimCutover(PC_A);
    // Aunque hubiera una fila hub suelta, en migrating no cuenta.
    await put(raw, 'hub', JSON.stringify(HUB));
    assert.equal(await bridge.readHubEnrollment(), null);
    await raw.execute("DELETE FROM app_meta WHERE key = 'hub'");
    await bridge.completeCutover(PC_A.deviceId, HUB);
    assert.deepEqual(await bridge.readHubEnrollment(), HUB);
  });

  it('readDeviceStatuses lee solo las claves device_status: y expone el machineId', async () => {
    await put(
      raw,
      'device_status:machine-b',
      JSON.stringify({
        deviceName: 'PC-B',
        appVersion: '1.8.0',
        lastPushOkAt: null,
        pendingChanges: 3,
        at: T0,
      }),
    );
    await put(raw, 'otra_clave', 'no es JSON ni importa');
    const statuses = await bridge.readDeviceStatuses();
    assert.deepEqual(statuses, [
      {
        deviceId: 'machine-b',
        deviceName: 'PC-B',
        appVersion: '1.8.0',
        lastPushOkAt: null,
        pendingChanges: 3,
        at: T0,
      },
    ]);
  });

  it('readDeviceStatuses expone seenCutoverAt y lo trata como opcional', async () => {
    await put(
      raw,
      'device_status:machine-b',
      JSON.stringify({
        deviceName: 'PC-B',
        appVersion: '1.8.1',
        lastPushOkAt: T0,
        pendingChanges: 0,
        at: T0,
        seenCutoverAt: T0 - 5,
      }),
    );
    const statuses = await bridge.readDeviceStatuses();
    assert.equal(statuses[0].seenCutoverAt, T0 - 5);
  });

  it('readLegacyMachines devuelve los machineId distintos de save_backups', async () => {
    await raw.execute(
      'CREATE TABLE save_backups (id INTEGER PRIMARY KEY, machineId TEXT NOT NULL, machineName TEXT NOT NULL)',
    );
    await raw.execute(
      "INSERT INTO save_backups (machineId, machineName) VALUES ('m-1', 'PC-1'), ('m-1', 'PC-1'), ('m-2', 'PC-2')",
    );
    assert.deepEqual(await bridge.readLegacyMachines(), [
      { machineId: 'm-1', machineName: 'PC-1' },
      { machineId: 'm-2', machineName: 'PC-2' },
    ]);
  });

  it('findLaggingDevices: solo es seguro quien repite el reclamo y no tiene pendientes', () => {
    const HOUR = 3_600_000;
    const lagging = findLaggingDevices(
      [
        status({ deviceId: 'machine-a', deviceName: 'PC-A', pendingChanges: 9 }),
        status({ deviceId: 'machine-b', deviceName: 'PC-B' }),
        // Sin subida buena, sus 2 operaciones pueden ser cambios de verdad.
        status({
          deviceId: 'machine-c',
          deviceName: 'PC-C',
          pendingChanges: 2,
          lastPushOkAt: null,
        }),
        // Subió en este ciclo: 2 operaciones son solo la contabilidad del sync.
        status({ deviceId: 'machine-i', deviceName: 'PC-I', pendingChanges: 2 }),
        status({ deviceId: 'machine-d', deviceName: 'PC-D', at: T0 - 2 * HOUR }),
        status({ deviceId: 'machine-e', deviceName: 'PC-E', at: T0 - HOUR }),
        // «0 pendientes» publicado ANTES del reclamo: no prueba nada.
        status({ deviceId: 'machine-f', deviceName: 'PC-F', seenCutoverAt: null }),
        status({ deviceId: 'machine-g', deviceName: 'PC-G', seenCutoverAt: undefined }),
        status({ deviceId: 'machine-h', deviceName: 'PC-H', seenCutoverAt: T0 - 1 }),
      ],
      'machine-a',
      T0,
      HOUR,
      T0,
    );
    assert.deepEqual(lagging, [
      { deviceId: 'machine-c', deviceName: 'PC-C', reason: 'pending-changes' },
      { deviceId: 'machine-d', deviceName: 'PC-D', reason: 'stale' },
      { deviceId: 'machine-f', deviceName: 'PC-F', reason: 'not-confirmed' },
      { deviceId: 'machine-g', deviceName: 'PC-G', reason: 'not-confirmed' },
      { deviceId: 'machine-h', deviceName: 'PC-H', reason: 'not-confirmed' },
    ]);
    assert.deepEqual(findLaggingDevices([], 'machine-a', T0, HOUR, T0), []);
  });

  it('effectivePendingChanges descuenta la contabilidad solo si subió en el mismo ciclo', () => {
    const at = T0;
    const value = (pendingChanges: number, lastPushOkAt: number | null): number =>
      effectivePendingChanges({ pendingChanges, lastPushOkAt, at });
    assert.equal(value(2, at - 105), 0);
    assert.equal(value(5, at - 105), 3);
    assert.equal(value(1, at), 0);
    assert.equal(value(2, null), 2);
    assert.equal(value(2, at - SAME_CYCLE_MS - 1), 2);
    // Una subida «del futuro» (relojes raros) no se fía.
    assert.equal(value(2, at + 1), 2);
  });

  it('findLaggingDevices: un PC de save_backups sin device_status nunca informó', () => {
    const lagging = findLaggingDevices(
      [status({ deviceId: 'machine-b' })],
      'machine-a',
      T0,
      3_600_000,
      T0,
      [
        { machineId: 'machine-a', machineName: 'PC-A' },
        { machineId: 'machine-b', machineName: 'PC-B' },
        { machineId: 'machine-z', machineName: 'PC-Z' },
      ],
    );
    assert.deepEqual(lagging, [
      { deviceId: 'machine-z', deviceName: 'PC-Z', reason: 'never-reported' },
    ]);
  });

  it('sin la tabla app_meta (1.8 sin instalar) todo da missing-table', async () => {
    await raw.execute('DROP TABLE app_meta');
    const calls: Array<() => Promise<unknown>> = [
      () => bridge.readCutover(),
      () => bridge.claimCutover(PC_A),
      () => bridge.releaseCutover(PC_A.deviceId),
      () => bridge.completeCutover(PC_A.deviceId, HUB),
      () => bridge.readDeviceStatuses(),
      () => bridge.readHubEnrollment(),
    ];
    for (const call of calls) {
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(error instanceof LegacyCutoverError);
        assert.equal(error.code, 'missing-table');
        return true;
      });
    }
  });

  it('JSON mal formado o fuera de contrato da malformed', async () => {
    await put(raw, 'cutover', '{no es json');
    await assert.rejects(bridge.readCutover(), { code: 'malformed' });
    await assert.rejects(bridge.claimCutover(PC_B), { code: 'malformed' });

    await raw.execute("DELETE FROM app_meta WHERE key = 'cutover'");
    await put(raw, 'cutover', JSON.stringify({ state: 'otro', deviceId: 'x' }));
    await assert.rejects(bridge.readCutover(), { code: 'malformed' });

    await put(raw, 'device_status:machine-z', JSON.stringify({ pendingChanges: 'muchos' }));
    await assert.rejects(bridge.readDeviceStatuses(), { code: 'malformed' });
  });

  it('un hub mal formado en una fila done da malformed', async () => {
    await bridge.claimCutover(PC_A);
    await bridge.completeCutover(PC_A.deviceId, HUB);
    await raw.execute({
      sql: "UPDATE app_meta SET value = ? WHERE key = 'hub'",
      args: [JSON.stringify({ url: 'https://hub.example.test' })],
    });
    await assert.rejects(bridge.readHubEnrollment(), { code: 'malformed' });
  });

  it('openLegacyCutover con credenciales vacías da not-configured', async () => {
    await assert.rejects(openLegacyCutover({ url: '', authToken: '' }), {
      code: 'not-configured',
    });
  });
});

describe('puente del corte 1.x: foto del remoto (snapshotRemote)', () => {
  let dir: string;
  let client: Client;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'afterplay-cutover-'));
    client = createClient({ url: pathToFileURL(join(dir, 'turso.db')).href });
  });

  afterEach(() => {
    client.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // EBUSY en Windows: lo barre scripts/clean-test-temp.ts
    }
  });

  const seed = async (): Promise<void> => {
    await client.batch(
      [
        CREATE_APP_META,
        'CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cover BLOB, rating REAL)',
        'CREATE INDEX games_name ON games (name)',
        'CREATE TABLE sessions (id INTEGER PRIMARY KEY, gameId INTEGER NOT NULL REFERENCES games(id), seconds INTEGER)',
        'CREATE TABLE plan_mailbox (id INTEGER PRIMARY KEY, kind TEXT, createdAt INTEGER, processedAt INTEGER)',
        'CREATE TABLE tags (name TEXT PRIMARY KEY, color TEXT) WITHOUT ROWID',
        // Tablas del replicador: no son datos y no se copian.
        'CREATE TABLE turso_cdc (change_id INTEGER PRIMARY KEY, payload TEXT)',
        "INSERT INTO turso_cdc VALUES (1, 'x')",
        "INSERT INTO tags VALUES ('rpg', '#fff'), ('indie', NULL)",
      ],
      'write',
    );
    // Más de una página (500 filas), con un blob, un real y un NULL.
    const inserts: InStatement[] = [];
    for (let id = 1; id <= 1203; id++) {
      inserts.push({
        sql: 'INSERT INTO games (id, name, cover, rating) VALUES (?, ?, ?, ?)',
        args: [id, `Juego ${id}`, id % 7 === 0 ? new Uint8Array([id % 256, 1, 2]) : null, id / 4],
      });
    }
    inserts.push({ sql: 'INSERT INTO sessions (gameId, seconds) VALUES (?, ?)', args: [1, 90] });
    await client.batch(inserts, 'write');
  };

  const dump = (path: string, table: string): Record<string, unknown>[] => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  };

  it('copia cada tabla de datos igual que el remoto, con su esquema e índices, y nada del replicador', async () => {
    await seed();
    const bridge = createLegacyCutover(client, () => T0);
    const dest = join(dir, 'snapshot.db');
    const report = await bridge.snapshotRemote(dest);

    assert.deepEqual(report.tables, {
      app_meta: 0,
      games: 1203,
      plan_mailbox: 0,
      sessions: 1,
      tags: 2,
    });
    assert.equal(report.rows, 1206);
    assert.equal(report.pendingMailbox, 0);

    for (const table of Object.keys(report.tables)) {
      const remote = await client.execute(`SELECT * FROM "${table}" ORDER BY 1`);
      const local = dump(dest, table);
      assert.equal(local.length, remote.rows.length, table);
      remote.rows.forEach((row, at) => {
        for (const column of remote.columns) {
          const got = local[at]?.[column];
          const want = row[column];
          if (want instanceof ArrayBuffer) assert.deepEqual(got, new Uint8Array(want), table);
          else assert.equal(got, want, `${table}.${column}`);
        }
      });
    }

    const db = new DatabaseSync(dest, { readOnly: true });
    try {
      const names = (
        db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all() as {
          name: string;
        }[]
      ).map((r) => r.name);
      assert.ok(names.includes('games_name'), 'el índice se recrea');
      assert.equal(
        names.some((name) => name.startsWith('turso_')),
        false,
      );
    } finally {
      db.close();
    }
  });

  it('una fila que solo existe en el remoto acaba en la foto', async () => {
    await seed();
    await client.execute("INSERT INTO games (id, name) VALUES (5000, 'Solo en Turso')");
    const dest = join(dir, 'snapshot.db');
    await createLegacyCutover(client, () => T0).snapshotRemote(dest);
    const rows = dump(dest, 'games') as { id: number; name: string }[];
    assert.ok(rows.some((r) => r.id === 5000 && r.name === 'Solo en Turso'));
  });

  it('cuenta las órdenes del buzón sin procesar', async () => {
    await seed();
    await client.batch(
      [
        "INSERT INTO plan_mailbox (kind, createdAt, processedAt) VALUES ('a', 1, NULL)",
        "INSERT INTO plan_mailbox (kind, createdAt, processedAt) VALUES ('b', 1, 5)",
        "INSERT INTO plan_mailbox (kind, createdAt, processedAt) VALUES ('c', 2, NULL)",
      ],
      'write',
    );
    const report = await createLegacyCutover(client, () => T0).snapshotRemote(
      join(dir, 'snapshot.db'),
    );
    assert.equal(report.pendingMailbox, 2);
  });

  it('si el destino no se puede crear, falla sin dejar nada', async () => {
    await seed();
    const dest = join(dir, 'no-existe', 'x.db');
    await assert.rejects(createLegacyCutover(client, () => T0).snapshotRemote(dest));
    assert.equal(existsSync(dest), false);
  });
});
