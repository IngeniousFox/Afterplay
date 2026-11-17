import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { QueryContext } from '../../db/v2/queries/common';
import { seedGame, type QueryFixture } from '../../db/v2/queries/common/__tests__/fixtures';
import {
  getLastSyncedHash,
  getSaveReindexError,
  isSaveReindexPending,
  listSaveBackups,
  markSaveReindexPending,
} from '../../db/v2/queries/saves';
import { openSavesDb } from '../../db/v2/queries/saves/__tests__/fixture';
import { computeContentHash } from '../contentHash';
import { createFakeBucket } from './fakeBucket';
import { h, mappingYaml, type FakeBackupSpec } from './saveFixtures';

// Reindexado de las partidas tras importar la 1.x (postImportReindex.ts).
// Bucket y base de mentira. Datos inventados.

const bucket = createFakeBucket();
const dbRef: { ctx: QueryContext | null } = { ctx: null };

mock.module('electron', { namedExports: { app: { getPath: () => '.' }, dialog: {} } });
mock.module('../r2', { namedExports: bucket.r2Exports() });
mock.module('../../db/v2/appDb', { namedExports: { appCtx: () => dbRef.ctx as QueryContext } });
mock.module('../machine', { namedExports: { setPruneFloor: () => {} } });

type Job = typeof import('../postImportReindex');
let job: Job;
let fx: QueryFixture;

before(async () => {
  job = await import('../postImportReindex');
});
after(() => mock.reset());

beforeEach(() => {
  bucket.objects.clear();
  bucket.resetWrites();
  bucket.failNext = {};
  bucket.config = { bucket: 'bucket-de-prueba', destination: 'destino-de-prueba' };
  bucket.reads.list = 0;
  fx = openSavesDb();
  dbRef.ctx = fx.ctx;
});
afterEach(() => fx.close());

const HOME = 'C:/Users/ana';
const SAVE = `${HOME}/AppData/Local/Celeste/slot1.sav`;
const OLD: FakeBackupSpec = {
  name: 'backup-20260101T000000Z.zip',
  when: '2026-01-01T00:00:00Z',
  files: { [SAVE]: { hash: h('1'), size: 10 } },
};
const NEW: FakeBackupSpec = {
  name: 'backup-20260102T000000Z.zip',
  when: '2026-01-02T00:00:00Z',
  files: { [SAVE]: { hash: h('2'), size: 10 } },
};
const OTHER_PC = 'device-ajeno';

const putFolder = (saveKey: string, deviceId: string, specs: FakeBackupSpec[]): void => {
  for (const spec of specs) bucket.put(`saves/${saveKey}/${deviceId}/${spec.name}`, spec.name);
  bucket.put(`saves/${saveKey}/${deviceId}/mapping.yaml`, mappingYaml('Celeste', specs));
};
const expectedHash = (spec: FakeBackupSpec, home: string): string | null =>
  computeContentHash({
    files: [{ path: SAVE, hash: spec.files[SAVE]?.hash }],
    registryHash: null,
    home,
  });

describe('runPendingSaveReindex', () => {
  it('sin importación (sin marcador) no toca el bucket', async () => {
    seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    putFolder('26226', fx.ctx.deviceId, [OLD]);

    assert.deepEqual(await job.runPendingSaveReindex(), { status: 'not_pending' });
    assert.equal(bucket.reads.list, 0);
    assert.equal(listSaveBackups(fx.ctx, 'x').length, 0);
  });

  it('sin credenciales espera: el marcador sigue y no se lista nada', async () => {
    markSaveReindexPending(fx.ctx);
    bucket.config.bucket = null;

    assert.deepEqual(await job.runPendingSaveReindex(), { status: 'not_configured' });
    assert.equal(bucket.reads.list, 0);
    assert.equal(isSaveReindexPending(fx.ctx), true);
    assert.equal(getSaveReindexError(fx.ctx), null);
  });

  it('con marcador y credenciales reindexa, siembra la huella y cierra el marcador', async () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    putFolder('26226', fx.ctx.deviceId, [OLD, NEW]);
    markSaveReindexPending(fx.ctx);

    const outcome = await job.runPendingSaveReindex();

    assert.deepEqual(outcome, { status: 'done', recovered: 2, seeded: 1 });
    assert.equal(isSaveReindexPending(fx.ctx), false);
    // La huella sale de cada mapping.yaml, con la carpeta de usuario de este PC
    // (no hay manifiesto en el bucket: se usa la de `devices`).
    const rows = listSaveBackups(fx.ctx, game);
    assert.equal(
      rows.find((row) => row.backupName === OLD.name)?.contentHash,
      expectedHash(OLD, HOME),
    );
    assert.equal(
      rows.find((row) => row.backupName === NEW.name)?.contentHash,
      expectedHash(NEW, HOME),
    );
    assert.equal(getLastSyncedHash(fx.ctx, game), expectedHash(NEW, HOME));
    // Solo lee: no sube ni borra nada.
    assert.deepEqual(bucket.writes, []);
  });

  it('lastSyncedHash viene solo de la copia más reciente de ESTE PC, no de otro', async () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const own: FakeBackupSpec = { ...OLD, when: '2026-01-01T00:00:00Z' };
    const theirs: FakeBackupSpec = { ...NEW, when: '2026-03-01T00:00:00Z' };
    putFolder('26226', fx.ctx.deviceId, [own]);
    putFolder('26226', OTHER_PC, [theirs]);
    bucket.put(
      `machines/${OTHER_PC}.json`,
      JSON.stringify({ machineId: OTHER_PC, machineName: 'PC-B', home: 'C:/Users/bea' }),
    );
    markSaveReindexPending(fx.ctx);

    const outcome = await job.runPendingSaveReindex();

    assert.deepEqual(outcome, { status: 'done', recovered: 2, seeded: 1 });
    assert.equal(getLastSyncedHash(fx.ctx, game), expectedHash(own, HOME));
    assert.notEqual(getLastSyncedHash(fx.ctx, game), expectedHash(theirs, 'C:/Users/bea'));
  });

  it('un juego sin copia propia queda sin huella', async () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    putFolder('26226', OTHER_PC, [NEW]);
    markSaveReindexPending(fx.ctx);

    const outcome = await job.runPendingSaveReindex();

    assert.deepEqual(outcome, { status: 'done', recovered: 1, seeded: 0 });
    assert.equal(getLastSyncedHash(fx.ctx, game), null);
  });

  it('si falla se queda pendiente y el siguiente intento lo completa', async () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    putFolder('26226', fx.ctx.deviceId, [OLD]);
    markSaveReindexPending(fx.ctx);
    bucket.failNext.listKeys = new Error('sin red');

    const failed = await job.runPendingSaveReindex();

    assert.deepEqual(failed, { status: 'failed', error: 'sin red' });
    assert.equal(isSaveReindexPending(fx.ctx), true);
    assert.equal(getSaveReindexError(fx.ctx), 'sin red');
    assert.equal(listSaveBackups(fx.ctx, game).length, 0);

    const retried = await job.runPendingSaveReindex();

    assert.deepEqual(retried, { status: 'done', recovered: 1, seeded: 1 });
    assert.equal(isSaveReindexPending(fx.ctx), false);
    assert.equal(getSaveReindexError(fx.ctx), null);
    assert.equal(getLastSyncedHash(fx.ctx, game), expectedHash(OLD, HOME));
  });

  it('una vez cumplido no vuelve a listar el bucket', async () => {
    seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    putFolder('26226', fx.ctx.deviceId, [OLD]);
    markSaveReindexPending(fx.ctx);
    await job.runPendingSaveReindex();
    const lists = bucket.reads.list;

    assert.deepEqual(await job.runPendingSaveReindex(), { status: 'not_pending' });
    assert.equal(bucket.reads.list, lists);
  });
});
