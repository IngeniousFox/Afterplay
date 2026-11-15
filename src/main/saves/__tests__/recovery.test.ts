import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { QueryContext } from '../../db/v2/queries/common';
import {
  OTHER,
  asOtherDevice,
  seedGame,
  seedSaveBackup,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import {
  getLastSyncedHash,
  listSaveBackups,
  saveBackupIdForKey,
  saveObjectKey,
  setLastSyncedHash,
} from '../../db/v2/queries/saves';
import { openSavesDb } from '../../db/v2/queries/saves/__tests__/fixture';
import { computeContentHash } from '../contentHash';
import { createFakeBucket } from './fakeBucket';
import { SAVE_PATH, h, mappingYaml, type FakeBackupSpec } from './saveFixtures';

// Recuperación del índice, inventario del bucket y limpieza de carpetas
// (recovery.ts, F-21, §12.7). Bucket y base de mentira. Datos inventados.

const bucket = createFakeBucket();
const dbRef: { ctx: QueryContext | null } = { ctx: null };
const pruneFloors: Date[] = [];

mock.module('electron', { namedExports: { app: { getPath: () => '.' }, dialog: {} } });
mock.module('../r2', { namedExports: bucket.r2Exports() });
mock.module('../../db/v2/appDb', { namedExports: { appCtx: () => dbRef.ctx as QueryContext } });
mock.module('../machine', {
  namedExports: { setPruneFloor: (when: Date) => pruneFloors.push(when) },
});

type Recovery = typeof import('../recovery');
let recovery: Recovery;
let fx: QueryFixture;

before(async () => {
  recovery = await import('../recovery');
});
after(() => mock.reset());

beforeEach(() => {
  bucket.objects.clear();
  bucket.resetWrites();
  bucket.failNext = {};
  pruneFloors.length = 0;
  fx = openSavesDb();
  dbRef.ctx = fx.ctx;
});
afterEach(() => fx.close());

const BEA_HOME = 'C:/Users/bea';
const BEA_SAVE = `${BEA_HOME}/AppData/Local/Celeste/slot1.sav`;
const keyOf = (saveKey: string, deviceId: string, name: string): string =>
  `saves/${saveKey}/${deviceId}/${name}`;

const spec = (name: string, when: string, hash: string): FakeBackupSpec => ({
  name,
  when,
  files: { [BEA_SAVE]: { hash, size: 10 } },
});
const A = spec('backup-20260101T000000Z.zip', '2026-01-01T00:00:00Z', h('1'));
const B = spec('backup-20260102T000000Z.zip', '2026-01-02T00:00:00Z', h('2'));

/** La carpeta de un PC en el bucket: sus zips y su mapping.yaml. */
const putFolder = (
  saveKey: string,
  deviceId: string,
  specs: FakeBackupSpec[],
  options: { mapping?: string | null; zips?: string[] } = {},
): void => {
  for (const name of options.zips ?? specs.map((candidate) => candidate.name)) {
    bucket.put(keyOf(saveKey, deviceId, name), `zip:${name}`);
  }
  if (options.mapping !== null) {
    bucket.put(
      keyOf(saveKey, deviceId, 'mapping.yaml'),
      options.mapping ?? mappingYaml('Celeste', specs),
    );
  }
};
const putManifest = (deviceId: string, extra: Record<string, unknown> = {}): void => {
  bucket.put(
    `machines/${deviceId}.json`,
    JSON.stringify({ machineId: deviceId, machineName: 'PC-B', home: BEA_HOME, ...extra }),
  );
};

const celeste = (): string => seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
const hashRow = (deviceId: string, name: string): { contentHash: unknown; parent: unknown } => {
  const row = fx.ctx.db.$client
    .prepare('SELECT contentHash, parentContentHash FROM "save_backups" WHERE id = ?')
    .get(saveBackupIdForKey(keyOf('26226', deviceId, name))) as {
    contentHash: unknown;
    parentContentHash: unknown;
  };
  return { contentHash: row.contentHash, parent: row.parentContentHash };
};

describe('recoverIndexFromCloud', () => {
  it('crea las filas con id determinista y la huella calculada con la carpeta de usuario del manifiesto', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A, B]);
    putManifest(OTHER);

    const result = await recovery.recoverIndexFromCloud();

    assert.deepEqual(result, { recovered: 2, skippedNoGame: 0, unreadableFolders: 0 });
    const rows = listSaveBackups(fx.ctx, gameId);
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      [
        saveBackupIdForKey(keyOf('26226', OTHER, A.name)),
        saveBackupIdForKey(keyOf('26226', OTHER, B.name)),
      ].sort(),
    );
    const expected = computeContentHash({
      files: [{ path: BEA_SAVE, hash: h('1') }],
      registryHash: null,
      home: BEA_HOME,
    });
    assert.equal(rows.find((row) => row.backupName === A.name)?.contentHash, expected);
    assert.equal(rows[0].machineName, 'PC-B');
    assert.equal(rows[0].machineHome, BEA_HOME);
    // El linaje nunca se recupera.
    assert.equal(hashRow(OTHER, A.name).parent, null);
  });

  it('la huella recuperada coincide con la que calculó su dueño al subir (otra carpeta de usuario)', async () => {
    celeste();
    putFolder('26226', OTHER, [A]);
    putManifest(OTHER);
    await recovery.recoverIndexFromCloud();
    const ownerSide = computeContentHash({
      files: [{ path: SAVE_PATH.replace('ana', 'bea'), hash: h('1') }],
      registryHash: null,
      home: BEA_HOME,
    });
    assert.equal(hashRow(OTHER, A.name).contentHash, ownerSide);
  });

  it('ejecutarlo dos veces no duplica nada (F-21)', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A, B]);
    putManifest(OTHER);
    await recovery.recoverIndexFromCloud();
    const second = await recovery.recoverIndexFromCloud();
    assert.equal(second.recovered, 0);
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 2);
  });

  it('sin manifiesto de la máquina no hay huella (no se deduce la carpeta de usuario), pero sí fila', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A]);

    const result = await recovery.recoverIndexFromCloud();

    assert.equal(result.recovered, 1);
    assert.equal(hashRow(OTHER, A.name).contentHash, null);
    const [row] = listSaveBackups(fx.ctx, gameId);
    assert.equal(row.machineName, 'Unknown PC');
    // El home sí se deduce de las rutas para poder redirigir al restaurar.
    assert.equal(row.machineHome, BEA_HOME);
  });

  it('un manifiesto sin home tampoco da huella', async () => {
    celeste();
    putFolder('26226', OTHER, [A]);
    putManifest(OTHER, { home: '' });
    await recovery.recoverIndexFromCloud();
    assert.equal(hashRow(OTHER, A.name).contentHash, null);
  });

  it('se salta las carpetas de juegos que no están en la biblioteca y las cuenta', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A]);
    putFolder('999', OTHER, [A, B]);
    putManifest(OTHER);

    const result = await recovery.recoverIndexFromCloud();

    assert.equal(result.recovered, 1);
    assert.equal(result.skippedNoGame, 2);
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 1);
    assert.equal(fx.ctx.db.$client.prepare('SELECT count(*) AS n FROM "save_backups"').get()?.n, 1);
  });

  it('un juego borrado de la biblioteca tampoco se recupera', async () => {
    const gameId = celeste();
    fx.ctx.store.remove('games', gameId);
    putFolder('26226', OTHER, [A]);
    putManifest(OTHER);
    const result = await recovery.recoverIndexFromCloud();
    assert.equal(result.recovered, 0);
    assert.equal(result.skippedNoGame, 1);
  });

  it('pone el suelo de poda solo si recuperó algo', async () => {
    celeste();
    putFolder('26226', OTHER, [A]);
    putManifest(OTHER);
    await recovery.recoverIndexFromCloud();
    assert.equal(pruneFloors.length, 1);
    assert.ok(Math.abs(Date.now() - pruneFloors[0].getTime()) < 60_000);
    await recovery.recoverIndexFromCloud(); // nada nuevo
    assert.equal(pruneFloors.length, 1);
  });

  it('una carpeta sin mapping.yaml o con uno ilegible cuenta como ilegible y no rompe el resto', async () => {
    const gameId = celeste();
    seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    seedGame(fx.ctx, { title: 'Tunic', igdbId: 5 });
    putFolder('26226', OTHER, [A]);
    putFolder('113112', OTHER, [A], { mapping: null });
    putFolder('5', OTHER, [A], { mapping: '{{{ no es yaml' });
    putManifest(OTHER);

    const result = await recovery.recoverIndexFromCloud();

    assert.equal(result.recovered, 1);
    assert.equal(result.unreadableFolders, 2);
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 1);
  });

  it('versiones del mapping.yaml cuyo zip ya no está en el bucket no generan filas', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A, B], { zips: [A.name] });
    putManifest(OTHER);
    const result = await recovery.recoverIndexFromCloud();
    assert.equal(result.recovered, 1);
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.backupName),
      [A.name],
    );
  });

  it('el tamaño es el del objeto del bucket, no el del mapping', async () => {
    const gameId = celeste();
    putFolder('26226', OTHER, [A]);
    bucket.put(keyOf('26226', OTHER, A.name), Buffer.alloc(1234));
    putManifest(OTHER);
    await recovery.recoverIndexFromCloud();
    assert.equal(listSaveBackups(fx.ctx, gameId)[0].sizeBytes, 1234);
  });

  it('recupera también las copias propias (índice perdido) sin tocar lastSyncedHash', async () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h-previa');
    putFolder('26226', fx.ctx.deviceId, [A]);
    putManifest(fx.ctx.deviceId, { machineName: 'PC-A', home: 'C:/Users/ana' });

    const result = await recovery.recoverIndexFromCloud();

    assert.equal(result.recovered, 1);
    assert.equal(listSaveBackups(fx.ctx, gameId)[0].machineId, fx.ctx.deviceId);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h-previa');
  });

  it('una copia con objeto y mapping pero ya indexada no se vuelve a leer (sin lecturas del mapping)', async () => {
    celeste();
    putFolder('26226', OTHER, [A]);
    putManifest(OTHER);
    await recovery.recoverIndexFromCloud();
    const reads = bucket.reads.readText;
    await recovery.recoverIndexFromCloud();
    assert.equal(bucket.reads.readText, reads);
  });
});

describe('scanBucket', () => {
  it('casa cada carpeta con su juego, marca los borrados y cuenta lo huérfano', async () => {
    const live = celeste();
    const gone = seedGame(fx.ctx, { title: 'Juego Borrado', saveKey: '77' });
    fx.ctx.store.remove('games', gone);
    putManifest(OTHER);
    putManifest(fx.ctx.deviceId, { machineName: 'PC-A' });
    putFolder('26226', fx.ctx.deviceId, [A, B]);
    putFolder('26226', OTHER, [A]);
    putFolder('77', OTHER, [A]);
    putFolder('555', OTHER, [A]);
    bucket.put('otra-cosa/ajena.bin', 'no es de Afterplay');
    // Indexadas: solo la copia propia A.
    seedSaveBackup(fx.ctx, {
      gameId: live,
      backupName: A.name,
      r2Key: keyOf('26226', fx.ctx.deviceId, A.name),
    });

    const inventory = await recovery.scanBucket();
    const folder = (
      saveKey: string,
      deviceId: string,
    ): (typeof inventory.folders)[number] | undefined =>
      inventory.folders.find((entry) => entry.saveKey === saveKey && entry.machineId === deviceId);

    assert.equal(folder('26226', fx.ctx.deviceId)?.gameTitle, 'Celeste');
    assert.equal(folder('26226', fx.ctx.deviceId)?.gameId, live);
    assert.equal(folder('26226', fx.ctx.deviceId)?.backupCount, 2);
    assert.equal(folder('26226', fx.ctx.deviceId)?.unknownCount, 1);
    assert.equal(folder('26226', OTHER)?.unknownCount, 1);

    const deleted = folder('77', OTHER);
    assert.equal(deleted?.gameTitle, 'Juego Borrado');
    assert.equal(deleted?.gameDeleted, true);
    assert.equal(deleted?.gameId, null);

    const unknown = folder('555', OTHER);
    assert.equal(unknown?.gameTitle, null);
    assert.equal(unknown?.gameDeleted, false);
    assert.equal(unknown?.gameId, null);

    assert.equal(inventory.folders.length, 4);
    // Lo que no es una clave de Afterplay no entra en las carpetas.
    assert.ok(inventory.folders.every((entry) => entry.saveKey !== 'otra-cosa'));
  });

  it('un juego vivo con el mismo saveKey que uno borrado manda sobre él', async () => {
    const old = seedGame(fx.ctx, { title: 'Viejo', saveKey: '77' });
    fx.ctx.store.remove('games', old);
    seedGame(fx.ctx, { title: 'Nuevo', saveKey: '77' });
    putFolder('77', OTHER, [A]);
    const folder = (await recovery.scanBucket()).folders[0];
    assert.equal(folder.gameTitle, 'Nuevo');
    assert.equal(folder.gameDeleted, false);
  });

  it('totales por máquina con el nombre del manifiesto y la propia marcada', async () => {
    celeste();
    putManifest(OTHER);
    putFolder('26226', fx.ctx.deviceId, [A]);
    putFolder('26226', OTHER, [A, B]);
    const inventory = await recovery.scanBucket();
    const own = inventory.machines.find((machine) => machine.machineId === fx.ctx.deviceId);
    const other = inventory.machines.find((machine) => machine.machineId === OTHER);
    assert.equal(own?.isCurrent, true);
    assert.equal(own?.machineName, null);
    assert.equal(other?.isCurrent, false);
    assert.equal(other?.machineName, 'PC-B');
    assert.equal(other?.home, BEA_HOME);
    assert.equal(other?.backupCount, 2);
    assert.equal(own?.backupCount, 1);
    assert.equal(inventory.objectCount, bucket.keys('saves/').length);
  });
});

describe('purgeSaveFolder', () => {
  const deletedGame = (saveKey: string): string => {
    const id = seedGame(fx.ctx, { title: `Juego ${saveKey}`, saveKey });
    seedSaveBackup(fx.ctx, {
      gameId: id,
      backupName: A.name,
      r2Key: keyOf(saveKey, fx.ctx.deviceId, A.name),
    });
    asOtherDevice(fx.ctx, { deviceId: OTHER }).seedSaveBackup({
      gameId: id,
      backupName: B.name,
      r2Key: keyOf(saveKey, OTHER, B.name),
    });
    putFolder(saveKey, fx.ctx.deviceId, [A]);
    putFolder(saveKey, OTHER, [B]);
    fx.ctx.store.remove('games', id);
    return id;
  };
  const liveRows = (): number =>
    (
      fx.ctx.db.$client
        .prepare('SELECT count(*) AS n FROM "save_backups" WHERE syncDeleted IS NULL')
        .get() as { n: number }
    ).n;

  it('un juego vivo lo impide: ni objetos ni filas se tocan', async () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', saveKey: '12' });
    seedSaveBackup(fx.ctx, {
      gameId: id,
      backupName: A.name,
      r2Key: keyOf('12', fx.ctx.deviceId, A.name),
    });
    putFolder('12', fx.ctx.deviceId, [A]);
    bucket.resetWrites();

    await assert.rejects(recovery.purgeSaveFolder('12'), /still in your library/);

    assert.deepEqual(bucket.writes, []);
    assert.equal(liveRows(), 1);
  });

  it('borra los objetos de TODOS los PCs de esa carpeta y pone lápida a sus filas', async () => {
    deletedGame('12');
    bucket.resetWrites();

    const removed = await recovery.purgeSaveFolder('12');

    assert.equal(removed, 4); // dos zips y dos mapping.yaml
    assert.deepEqual(bucket.keys('saves/12/'), []);
    assert.equal(liveRows(), 0);
  });

  it('el prefijo 12 no se lleva 123 (ni objetos ni filas)', async () => {
    deletedGame('12');
    deletedGame('123');

    await recovery.purgeSaveFolder('12');

    assert.deepEqual(bucket.keys('saves/12/'), []);
    assert.equal(bucket.keys('saves/123/').length, 4);
    assert.equal(liveRows(), 2);
  });

  it('no toca objetos que no tienen la forma de una copia de Afterplay', async () => {
    deletedGame('12');
    bucket.put('saves/12/suelto.txt', 'x');
    bucket.put(keyOf('12', OTHER, 'sub/dentro.zip'), 'x');

    await recovery.purgeSaveFolder('12');

    assert.deepEqual(
      bucket.keys('saves/12/'),
      ['saves/12/suelto.txt', keyOf('12', OTHER, 'sub/dentro.zip')].sort(),
    );
  });

  it('si el bucket falla, el índice no se toca (el bucket va primero)', async () => {
    deletedGame('12');
    bucket.failNext.deleteKeys = new Error('R2 no responde');
    await assert.rejects(recovery.purgeSaveFolder('12'), /R2 no responde/);
    assert.equal(liveRows(), 2);
  });

  it('una carpeta sin ningún juego asociado también se puede limpiar', async () => {
    putFolder('555', OTHER, [A]);
    assert.equal(await recovery.purgeSaveFolder('555'), 2);
    assert.deepEqual(bucket.keys('saves/555/'), []);
  });

  it('repetirlo no falla ni borra nada más', async () => {
    deletedGame('12');
    await recovery.purgeSaveFolder('12');
    assert.equal(await recovery.purgeSaveFolder('12'), 0);
  });
});

describe('deleteMachineFromCloud', () => {
  it('rechaza este PC y no toca nada', async () => {
    celeste();
    putFolder('26226', fx.ctx.deviceId, [A]);
    putManifest(fx.ctx.deviceId);
    bucket.resetWrites();

    await assert.rejects(recovery.deleteMachineFromCloud(fx.ctx.deviceId), /this PC/);

    assert.deepEqual(bucket.writes, []);
  });

  it('borra todo lo de la otra máquina (de todos los juegos) y su manifiesto; lo demás queda', async () => {
    const gameId = celeste();
    const other = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    const b = asOtherDevice(fx.ctx, { deviceId: OTHER });
    b.seedSaveBackup({ gameId, backupName: A.name, r2Key: keyOf('26226', OTHER, A.name) });
    b.seedSaveBackup({ gameId: other, backupName: B.name, r2Key: keyOf('113112', OTHER, B.name) });
    seedSaveBackup(fx.ctx, {
      gameId,
      backupName: A.name,
      r2Key: keyOf('26226', fx.ctx.deviceId, A.name),
    });
    putFolder('26226', OTHER, [A]);
    putFolder('113112', OTHER, [B]);
    putFolder('26226', fx.ctx.deviceId, [A]);
    putManifest(OTHER);
    putManifest(fx.ctx.deviceId);

    const removed = await recovery.deleteMachineFromCloud(OTHER);

    assert.equal(removed, 4);
    assert.deepEqual(
      bucket.keys('saves/').every((k) => k.includes(fx.ctx.deviceId)),
      true,
    );
    assert.equal(bucket.objects.has(`machines/${OTHER}.json`), false);
    assert.equal(bucket.objects.has(`machines/${fx.ctx.deviceId}.json`), true);
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.machineId),
      [fx.ctx.deviceId],
    );
    assert.equal(listSaveBackups(fx.ctx, other).length, 0);
  });

  it('si el bucket falla, las filas se quedan', async () => {
    const gameId = celeste();
    asOtherDevice(fx.ctx, { deviceId: OTHER }).seedSaveBackup({
      gameId,
      backupName: A.name,
      r2Key: keyOf('26226', OTHER, A.name),
    });
    putFolder('26226', OTHER, [A]);
    bucket.failNext.deleteKeys = new Error('R2 no responde');
    await assert.rejects(recovery.deleteMachineFromCloud(OTHER), /R2 no responde/);
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 1);
  });
});

// El helper de claves de la base y el de la fábrica de objetos coinciden.
describe('claves', () => {
  it('saveObjectKey de la base da la misma clave que la del bucket de pruebas', () => {
    assert.equal(
      saveObjectKey({ saveKey: '26226', deviceId: OTHER, backupName: A.name }),
      keyOf('26226', OTHER, A.name),
    );
  });
});
