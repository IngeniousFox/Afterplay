import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { QueryContext } from '../../db/v2/queries/common';
import {
  checkInstallNonce,
  getLastSyncedHash,
  readPublishedInstallNonce,
  setLastSyncedHash,
} from '../../db/v2/queries/saves';
import { seedGame, type QueryFixture } from '../../db/v2/queries/common/__tests__/fixtures';
import { openSavesDb } from '../../db/v2/queries/saves/__tests__/fixture';
import { createFakeBucket } from './fakeBucket';

// Identidad frente al bucket y el id duplicado (identity.ts, §12.6, F-24).
// La base es una en memoria; `machine.ts` es el de verdad sobre un userData
// temporal; el bucket es un fake. Datos inventados.

let userData = '';
const bucket = createFakeBucket();
const dbRef: { ctx: QueryContext | null } = { ctx: null };

mock.module('electron', {
  namedExports: {
    app: { getPath: () => userData },
    dialog: { showMessageBoxSync: () => 0 },
  },
});
mock.module('../r2', { namedExports: bucket.r2Exports() });
mock.module('../../db/v2/appDb', {
  namedExports: { appCtx: () => dbRef.ctx as QueryContext },
});
mock.module('../../config/store', { namedExports: { getConfigValue: () => 'cloudflare' } });

type Identity = typeof import('../identity');
type Machine = typeof import('../machine');
let identity: Identity;
let machine: Machine;
let fx: QueryFixture;

before(async () => {
  machine = await import('../machine');
  identity = await import('../identity');
});
after(() => mock.reset());

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'afterplay-saves-identity-'));
  machine.resetMachineCacheForTests();
  machine.setFingerprintReader(() => 'guid:windows-uno');
  machine.setCorruptIdentityPrompt(null);
  identity.resetIdentityChecksForTests();
  bucket.objects.clear();
  bucket.resetWrites();
  bucket.reads.readJsonStrict = 0;
  bucket.reads.readText = 0;
  bucket.reads.list = 0;
  bucket.failNext = {};
  bucket.config = { bucket: 'bucket-de-prueba', destination: 'destino-de-prueba' };
  fx = openSavesDb();
  dbRef.ctx = fx.ctx;
});
afterEach(() => {
  fx.close();
  machine.setFingerprintReader(null);
  rmSync(userData, { recursive: true, force: true });
});

const manifestKey = (): string => `machines/${machine.getMachineId()}.json`;
const manifest = (): { installNonce?: string; machineId: string } | null => {
  const text = bucket.text(manifestKey());
  return text ? JSON.parse(text) : null;
};
const isDuplicate = (error: unknown): boolean => error instanceof identity.DuplicateIdentityError;

describe('checkLocalInstallIdentity (barato y local)', () => {
  it('sin nada publicado: lo publica en devices y no hay duplicado', () => {
    const status = identity.checkLocalInstallIdentity();
    assert.deepEqual(status, { duplicate: false, detectedAt: null, where: null });
    assert.equal(readPublishedInstallNonce(fx.ctx), machine.getInstallNonce());
  });

  it('el publicado es el nuestro: sigue sin haber duplicado', () => {
    identity.checkLocalInstallIdentity();
    assert.equal(identity.checkLocalInstallIdentity().duplicate, false);
  });

  it('otro valor publicado: marca el duplicado (en devices) y se persiste', () => {
    checkInstallNonce(fx.ctx, 'valor-de-otra-instalacion');
    const status = identity.checkLocalInstallIdentity();
    assert.equal(status.duplicate, true);
    assert.equal(status.where, 'devices');
    assert.ok(status.detectedAt);
    // Sobrevive a un reinicio.
    machine.resetMachineCacheForTests();
    assert.equal(identity.checkLocalInstallIdentity().duplicate, true);
    // Y no pisa el valor de la otra instalación.
    assert.equal(readPublishedInstallNonce(fx.ctx), 'valor-de-otra-instalacion');
  });

  it('no toca la red', () => {
    checkInstallNonce(fx.ctx, 'otro');
    identity.checkLocalInstallIdentity();
    assert.equal(bucket.reads.list + bucket.reads.readJsonStrict + bucket.reads.readText, 0);
    assert.deepEqual(bucket.writes, []);
  });
});

describe('assertInstallIdentity (la puerta de toda escritura)', () => {
  it('con duplicado ya marcado lanza sin mirar el bucket', async () => {
    machine.markDuplicateIdentity('devices');
    await assert.rejects(identity.assertInstallIdentity(), isDuplicate);
    assert.equal(bucket.reads.readJsonStrict, 0);
  });

  it('el valor de devices de otra instalación lanza', async () => {
    checkInstallNonce(fx.ctx, 'otro');
    await assert.rejects(identity.assertInstallIdentity(), isDuplicate);
    assert.equal(machine.getDuplicateIdentity()?.where, 'devices');
  });

  it('sin almacenamiento configurado no mira el bucket', async () => {
    bucket.config.destination = null;
    await identity.assertInstallIdentity();
    assert.equal(bucket.reads.readJsonStrict, 0);
    assert.deepEqual(bucket.writes, []);
  });

  it('sin manifiesto en el bucket: publica el nuestro con el valor propio', async () => {
    await identity.assertInstallIdentity();
    assert.equal(manifest()?.installNonce, machine.getInstallNonce());
    assert.equal(manifest()?.machineId, machine.getMachineId());
  });

  it('con un manifiesto de antes de la 2.0 (sin valor): lo completa con el nuestro', async () => {
    bucket.put(
      manifestKey(),
      JSON.stringify({ machineId: machine.getMachineId(), machineName: 'PC' }),
    );
    await identity.assertInstallIdentity();
    assert.equal(manifest()?.installNonce, machine.getInstallNonce());
  });

  it('con el manifiesto nuestro: pasa y no escribe nada', async () => {
    bucket.put(
      manifestKey(),
      JSON.stringify({
        machineId: machine.getMachineId(),
        installNonce: machine.getInstallNonce(),
      }),
    );
    await identity.assertInstallIdentity();
    assert.deepEqual(bucket.writes, []);
  });

  it('manifiesto de OTRA instalación: lanza, marca el duplicado (bucket) y NO lo sobrescribe', async () => {
    const foreign = JSON.stringify({
      machineId: machine.getMachineId(),
      machineName: 'PC-copia',
      installNonce: 'valor-de-la-otra',
    });
    bucket.put(manifestKey(), foreign);
    await assert.rejects(identity.assertInstallIdentity(), isDuplicate);
    assert.equal(machine.getDuplicateIdentity()?.where, 'bucket');
    assert.equal(bucket.text(manifestKey()), foreign);
    assert.deepEqual(bucket.writes, []);
    // Y a partir de ahí, ni se mira: está marcado.
    const reads = bucket.reads.readJsonStrict;
    await assert.rejects(identity.assertInstallIdentity(), isDuplicate);
    assert.equal(bucket.reads.readJsonStrict, reads);
  });

  it('un fallo de red al leer el manifiesto corta y NO reescribe el manifiesto', async () => {
    const original = JSON.stringify({
      machineId: machine.getMachineId(),
      installNonce: 'valor-de-la-otra',
    });
    bucket.put(manifestKey(), original);
    bucket.failNext.readJsonStrict = new Error('socket hang up');

    await assert.rejects(identity.assertInstallIdentity(), /socket hang up/);

    assert.equal(bucket.text(manifestKey()), original);
    assert.deepEqual(bucket.writes, []);
    // Un fallo de red no es un duplicado.
    assert.equal(machine.getDuplicateIdentity(), null);
  });

  it('tras un fallo de red se vuelve a intentar en la siguiente llamada', async () => {
    bucket.failNext.readJsonStrict = new Error('timeout');
    await assert.rejects(identity.assertInstallIdentity(), /timeout/);
    await identity.assertInstallIdentity();
    assert.equal(manifest()?.installNonce, machine.getInstallNonce());
  });

  it('el bucket se mira una vez por destino y proceso', async () => {
    await identity.assertInstallIdentity();
    const reads = bucket.reads.readJsonStrict;
    await identity.assertInstallIdentity();
    assert.equal(bucket.reads.readJsonStrict, reads);
    // Otro destino: otra comprobación.
    bucket.config.destination = 'otro-destino';
    await identity.assertInstallIdentity();
    assert.equal(bucket.reads.readJsonStrict, reads + 1);
  });
});

describe('resolver el duplicado', () => {
  it('"este PC es el original": publica su valor en devices y en el bucket y desbloquea', async () => {
    bucket.put(
      manifestKey(),
      JSON.stringify({ machineId: machine.getMachineId(), installNonce: 'valor-de-la-otra' }),
    );
    checkInstallNonce(fx.ctx, 'valor-de-la-otra');
    await assert.rejects(identity.assertInstallIdentity(), isDuplicate);

    await identity.resolveDuplicateKeepingThisPc();

    assert.equal(readPublishedInstallNonce(fx.ctx), machine.getInstallNonce());
    assert.equal(manifest()?.installNonce, machine.getInstallNonce());
    assert.equal(machine.getDuplicateIdentity(), null);
    // Ya se puede escribir, sin volver a leer el bucket.
    const reads = bucket.reads.readJsonStrict;
    await identity.assertInstallIdentity();
    assert.equal(bucket.reads.readJsonStrict, reads);
  });

  it('"este PC es el original" sin almacenamiento: solo devices, sin tocar el bucket', async () => {
    bucket.config.destination = null;
    checkInstallNonce(fx.ctx, 'valor-de-la-otra');
    identity.checkLocalInstallIdentity();
    await identity.resolveDuplicateKeepingThisPc();
    assert.deepEqual(bucket.writes, []);
    assert.equal(readPublishedInstallNonce(fx.ctx), machine.getInstallNonce());
    assert.equal(machine.getDuplicateIdentity(), null);
  });

  it('"este PC es otro": id nuevo, huellas de partida olvidadas, duplicado limpio', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    setLastSyncedHash(fx.ctx, gameId, 'huella-de-la-copia');
    checkInstallNonce(fx.ctx, 'valor-de-la-otra');
    identity.checkLocalInstallIdentity();
    const oldId = machine.getMachineId();

    const newId = identity.resolveDuplicateWithNewIdentity();

    assert.notEqual(newId, oldId);
    assert.equal(machine.getMachineId(), newId);
    assert.equal(machine.getDuplicateIdentity(), null);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
    // Tras reiniciar (la base se abre con el id nuevo) la comprobación del
    // bucket es de verdad, para el id nuevo.
    const restarted = openSavesDb();
    dbRef.ctx = restarted.ctx;
    try {
      await identity.assertInstallIdentity();
    } finally {
      restarted.close();
    }
    assert.equal(bucket.text(`machines/${newId}.json`) !== null, true);
    assert.equal(bucket.text(`machines/${oldId}.json`), null);
  });
});

describe('reconciliación de identidad con el bucket', () => {
  it('needsIdentityCheck: falso sin almacenamiento, verdadero con uno no visto, falso con el visto', () => {
    bucket.config = { bucket: null, destination: null };
    assert.equal(identity.needsIdentityCheck(), false);
    bucket.config = { bucket: 'b', destination: 'destino-1' };
    assert.equal(identity.needsIdentityCheck(), true);
    machine.markIdentityReconciled('destino-1');
    assert.equal(identity.needsIdentityCheck(), false);
    bucket.config = { bucket: 'b', destination: 'destino-2' };
    assert.equal(identity.needsIdentityCheck(), true);
  });

  it('ensureIdentityBeforeUpload publica el manifiesto y, sin otras máquinas, marca el bucket como visto', async () => {
    await identity.ensureIdentityBeforeUpload();
    assert.ok(manifest());
    assert.equal(machine.getMachineIdentity()?.reconciledBucket, 'destino-de-prueba');
  });

  it('con otras máquinas en el bucket NO adopta ni marca: lo deja a Ajustes', async () => {
    const before = machine.getMachineId();
    bucket.put(
      'machines/0194c2f0-9999-7000-8000-000000000009.json',
      JSON.stringify({
        machineId: '0194c2f0-9999-7000-8000-000000000009',
        machineName: 'PC-viejo',
        home: 'C:/Users/ana',
      }),
    );
    await identity.ensureIdentityBeforeUpload();
    assert.equal(machine.getMachineId(), before);
    assert.notEqual(machine.getMachineIdentity()?.reconciledBucket, 'destino-de-prueba');
  });

  it('nunca lanza: un fallo del bucket no tumba el backup y no marca nada', async () => {
    bucket.failNext.listKeys = new Error('sin red');
    await identity.ensureIdentityBeforeUpload();
    assert.notEqual(machine.getMachineIdentity()?.reconciledBucket, 'destino-de-prueba');
    assert.deepEqual(bucket.writes, []);
  });

  it('adoptMachine cambia el id, protege lo anterior y republica el manifiesto', async () => {
    const adopted = '0194c2f0-7777-7000-8000-000000000007';
    await identity.adoptMachine(adopted);
    assert.equal(machine.getMachineId(), adopted);
    assert.ok(machine.getPruneFloor() instanceof Date);
    assert.equal(JSON.parse(bucket.text(`machines/${adopted}.json`) as string).machineId, adopted);
  });

  it('keepCurrentIdentity publica y marca el bucket como visto', async () => {
    await identity.keepCurrentIdentity();
    assert.ok(manifest());
    assert.equal(machine.getMachineIdentity()?.reconciledBucket, 'destino-de-prueba');
  });

  it('checkIdentity lista las otras máquinas y si esta ya subió algo', async () => {
    const other = '0194c2f0-9999-7000-8000-000000000009';
    bucket.put(
      `machines/${other}.json`,
      JSON.stringify({ machineId: other, machineName: 'PC-viejo', home: 'C:/Users/ana' }),
    );
    let check = await identity.checkIdentity();
    assert.equal(check?.claimed, false);
    assert.equal(check?.published, false);
    assert.deepEqual(
      check?.machines.map((machineInfo) => machineInfo.machineId),
      [other],
    );
    bucket.put(`saves/1/${machine.getMachineId()}/backup.zip`, 'x');
    await identity.publishMachineManifest();
    check = await identity.checkIdentity();
    assert.equal(check?.claimed, true);
    assert.equal(check?.published, true);
  });
});
