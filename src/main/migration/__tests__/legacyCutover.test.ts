import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createClient, type Client, type ResultSet } from '@libsql/client';
import {
  createLegacyCutover,
  findLaggingDevices,
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

  it('findLaggingDevices: ignora al propio PC y marca pendientes y rezagados', () => {
    const HOUR = 3_600_000;
    const lagging = findLaggingDevices(
      [
        status({ deviceId: 'machine-a', deviceName: 'PC-A', pendingChanges: 9 }),
        status({ deviceId: 'machine-b', deviceName: 'PC-B' }),
        status({ deviceId: 'machine-c', deviceName: 'PC-C', pendingChanges: 2 }),
        status({ deviceId: 'machine-d', deviceName: 'PC-D', at: T0 - 2 * HOUR }),
        status({ deviceId: 'machine-e', deviceName: 'PC-E', at: T0 - HOUR }),
      ],
      'machine-a',
      T0,
      HOUR,
    );
    assert.deepEqual(lagging, [
      { deviceId: 'machine-c', deviceName: 'PC-C', reason: 'pending-changes' },
      { deviceId: 'machine-d', deviceName: 'PC-D', reason: 'stale' },
    ]);
    assert.deepEqual(findLaggingDevices([], 'machine-a', T0, HOUR), []);
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
