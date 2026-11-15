import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { isStoreError } from '../../../src/main/db/v2/store';
import { saveBackupId } from '../../../src/shared/sync/ids';
import {
  LOCAL,
  T0,
  fakeWall,
  openTestDb,
  tempDir,
} from '../../../src/main/db/v2/__tests__/helpers';
import { createQueryContext } from '../../../src/main/db/v2/queries/common';
import { ensureThisDevice } from '../../../src/main/db/v2/queries/common/device';
import {
  checkInstallNonce,
  deletePlannedSaveBackups,
  getLastSyncedHash,
  listOwnDeletedBackupNames,
  listSaveBackups,
  listSaveLineage,
  planSaveBackupDeletion,
  readPublishedInstallNonce,
  recoverSaveBackups,
  setLastSyncedHash,
} from '../../../src/main/db/v2/queries/saves';
import { addGame } from '../actions';
import { HOUR_MS, World, convergenceProblems, diffAgainstHub, type Client } from '../harness';
import {
  EMPTY_DISK,
  hashOf,
  keyOf,
  liveBackupNames,
  onDisk,
  registerSaveMaintenanceRule,
  stateOf,
  uploadVersions,
  version,
} from '../savesHarness';

// Escenarios de aceptación de §17.3 de la fase 6 (partidas, §12): E-16..E-20.
// Como en `scenarios.test.ts`: hub real y clientes reales; lo que se comprueba
// sale de las consultas reales de `saves/` y de `computeSaveSyncState`. El
// bucket no existe: "subir" es llamar a `reconcileOwnSaveBackups`, que es lo
// que hace el espejo después de escribir en el bucket.

let world: World | null = null;

const start = (): World => {
  world = new World();
  return world;
};

afterEach(() => {
  world?.close();
  world = null;
});

async function settle(w: World): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w), []);
}

const when = (w: World, extraMs = 0): Date => new Date(w.hubTime.now + extraMs);

describe('E-16: A sube una partida; B abre la ficha sin haber jugado', () => {
  it('B ve "behind" con la partida nueva de A; A ve "synced"; un PC nuevo ve "available"', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const c = await w.addClient('c');
    const game = addGame(a, 501, { title: 'Hollow Heart' });
    await settle(w);

    // Partida base h0, subida por A; B la restaura (S = h0, disco = h0).
    uploadVersions(a, game, [version('backup-1.zip', 'h0', when(w))]);
    assert.equal(getLastSyncedHash(a.ctx, game), hashOf('h0'));
    await settle(w);
    setLastSyncedHash(b.ctx, game, hashOf('h0'));

    // A juega y sube h1: desciende de h0 (la huella de partida de A).
    w.advance(HOUR_MS);
    uploadVersions(a, game, [version('backup-2.zip', 'h1', when(w))]);
    await settle(w);

    const lineage = listSaveLineage(b.ctx, game);
    const h1Row = lineage.find((row) => row.contentHash === hashOf('h1'));
    assert.equal(h1Row?.parentContentHash, hashOf('h0'));

    const seenByB = stateOf(b, game, onDisk('h0'));
    assert.equal(seenByB.status, 'behind');
    assert.equal(seenByB.head?.contentHash, hashOf('h1'));
    assert.equal(seenByB.head?.deviceId, a.deviceId);
    assert.equal(seenByB.head?.isOwn, false);
    assert.equal(seenByB.tips.length, 1);

    assert.equal(stateOf(a, game, onDisk('h1')).status, 'synced');

    // Un PC que nunca ha tenido nada de este juego: solo "hay una partida".
    assert.equal(getLastSyncedHash(c.ctx, game), null);
    const seenByC = stateOf(c, game, EMPTY_DISK);
    assert.equal(seenByC.status, 'available');
    assert.equal(seenByC.head?.contentHash, hashOf('h1'));
  });
});

describe('E-17: A y B juegan desde la misma base sin restaurar, y ambos hacen backup', () => {
  it('los dos ven "diverged", también el que subió el último; restaurar y subir la cierra', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 502, { title: 'Celeste Moon' });
    await settle(w);

    uploadVersions(a, game, [version('backup-1.zip', 'h0', when(w))]);
    await settle(w);
    setLastSyncedHash(b.ctx, game, hashOf('h0'));

    // Sin red, cada uno juega por su lado y sube; B más tarde.
    a.cut();
    b.cut();
    w.advance(HOUR_MS);
    uploadVersions(a, game, [version('backup-2.zip', 'h1', when(w))]);
    w.advance(HOUR_MS);
    uploadVersions(b, game, [version('backup-3.zip', 'h2', when(w))]);
    a.restore();
    b.restore();
    await settle(w);

    const seenByA = stateOf(a, game, onDisk('h1'));
    const seenByB = stateOf(b, game, onDisk('h2'));
    for (const state of [seenByA, seenByB]) {
      assert.equal(state.status, 'diverged');
      assert.deepEqual(
        state.tips.map((tip) => tip.contentHash).sort(),
        [hashOf('h1'), hashOf('h2')].sort(),
      );
      assert.deepEqual(
        state.tips.map((tip) => tip.deviceId).sort(),
        [a.deviceId, b.deviceId].sort(),
      );
    }

    // B resuelve: restaura la de A (S = h1), juega y sube h3.
    setLastSyncedHash(b.ctx, game, hashOf('h1'));
    w.advance(HOUR_MS);
    uploadVersions(b, game, [version('backup-4.zip', 'h3', when(w))]);
    await settle(w);

    // §12.4: la divergencia se cierra al restaurar una punta y seguir jugando
    // desde ella. h2 queda en el historial (viva y restaurable), pero ya no es
    // punta: B, que la subió, siguió después por otro lado.
    const closedForA = stateOf(a, game, onDisk('h1'));
    const closedForB = stateOf(b, game, onDisk('h3'));
    for (const state of [closedForA, closedForB]) {
      assert.equal(state.tips.length, 1);
      assert.equal(state.tips[0].contentHash, hashOf('h3'));
    }
    assert.equal(closedForB.status, 'synced');
    assert.equal(closedForA.status, 'behind');
    assert.ok(
      listSaveBackups(a.ctx, game).some((row) => row.backupName === 'backup-3.zip'),
      'h2 sigue en la lista de versiones',
    );
  });

  it('también se cierra si el que restaura es el otro PC (A sigue desde h2 de B)', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 506, { title: 'Celeste Moon II' });
    await settle(w);
    uploadVersions(a, game, [version('backup-1.zip', 'h0', when(w))]);
    await settle(w);
    setLastSyncedHash(b.ctx, game, hashOf('h0'));
    w.advance(HOUR_MS);
    uploadVersions(a, game, [version('backup-2.zip', 'h1', when(w))]);
    w.advance(HOUR_MS);
    uploadVersions(b, game, [version('backup-1.zip', 'h2', when(w))]);
    await settle(w);
    assert.equal(stateOf(a, game, onDisk('h1')).status, 'diverged');

    // A restaura la de B (S = h2), juega y sube h3.
    setLastSyncedHash(a.ctx, game, hashOf('h2'));
    w.advance(HOUR_MS);
    uploadVersions(a, game, [version('backup-3.zip', 'h3', when(w))]);
    await settle(w);

    const seenByA = stateOf(a, game, onDisk('h3'));
    const seenByB = stateOf(b, game, onDisk('h2'));
    assert.equal(seenByA.status, 'synced');
    assert.equal(seenByB.status, 'behind');
    for (const state of [seenByA, seenByB]) {
      assert.deepEqual(
        state.tips.map((tip) => tip.contentHash),
        [hashOf('h3')],
      );
    }
  });
});

describe('E-18: recuperar el índice desde el bucket con el sync a medias', () => {
  async function setup(): Promise<{
    w: World;
    a: Client;
    b: Client;
    game: string;
    keys: string[];
    recoverInput: Parameters<typeof recoverSaveBackups>[1];
  }> {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 503, { title: 'Dust Garden' });
    await settle(w);
    registerSaveMaintenanceRule(b);

    const created1 = when(w);
    const created2 = when(w, HOUR_MS);
    uploadVersions(a, game, [
      version('backup-1.zip', 'h1', created1),
      version('backup-2.zip', 'h2', created2),
    ]);
    await a.syncOk();

    const keys = [keyOf(a, game, 'backup-1.zip'), keyOf(a, game, 'backup-2.zip')];
    // Lo que sacaría la recuperación del listado del bucket y del manifiesto de A.
    const recoverInput: Parameters<typeof recoverSaveBackups>[1] = {
      devices: [{ deviceId: a.deviceId, name: 'PC-a', home: 'C:\\Users\\a' }],
      backups: [
        { label: 'h1', createdAt: created1, r2Key: keys[0] },
        { label: 'h2', createdAt: created2, r2Key: keys[1] },
      ].map(({ label, createdAt, r2Key }) => ({
        gameId: game,
        r2Key,
        createdAt,
        sizeBytes: 1024,
        ludusaviName: 'Juego inventado',
        differential: false,
        parentBackupName: null,
        locations: null,
        hasRegistry: false,
        contentHash: hashOf(label),
      })),
    };
    return { w, a, b, game, keys, recoverInput };
  }

  function assertOneRowPerKey(w: World, keys: readonly string[], game: string): void {
    for (const key of keys) {
      const id = saveBackupId(key);
      assert.ok(w.hubRaw('save_backups', id), `el hub tiene ${key}`);
      for (const client of w.clients) {
        const own = listSaveBackups(client.ctx, game).filter((row) => row.id === id);
        assert.equal(own.length, 1, `${client.name}: una sola fila para ${key}`);
      }
    }
    for (const client of w.clients) {
      assert.equal(client.rows('save_backups').size, keys.length, `${client.name}: nº de filas`);
    }
    assert.equal(w.hubRows('save_backups').size, keys.length);
  }

  it('recuperar antes de bajar no duplica y no borra el linaje de A', async () => {
    const { w, a, b, game, keys, recoverInput } = await setup();
    const result = recoverSaveBackups(b.ctx, recoverInput);
    assert.equal(result.recovered, 2);
    assert.equal(result.alreadyIndexed, 0);
    await settle(w);

    assertOneRowPerKey(w, keys, game);
    for (const client of [a, b]) {
      const rows = listSaveLineage(client.ctx, game);
      assert.deepEqual(
        rows.map((row) => row.contentHash).sort(),
        [hashOf('h1'), hashOf('h2')].sort(),
      );
      const second = rows.find((row) => row.contentHash === hashOf('h2'));
      assert.equal(
        second?.parentContentHash,
        hashOf('h1'),
        `${client.name}: el linaje de A sobrevive`,
      );
    }
    assert.deepEqual(diffAgainstHub(w), []);
  });

  it('recuperar después de bajar no encuentra nada que recuperar', async () => {
    const { w, b, game, keys, recoverInput } = await setup();
    await settle(w);
    const result = recoverSaveBackups(b.ctx, recoverInput);
    assert.equal(result.recovered, 0);
    assert.equal(result.alreadyIndexed, 2);
    await settle(w);
    assertOneRowPerKey(w, keys, game);
    assert.deepEqual(diffAgainstHub(w), []);
  });
});

describe('E-19: A borra una versión de B', () => {
  it('no reaparece en el siguiente backup de B', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 504, { title: 'Moss Library' });
    await settle(w);
    registerSaveMaintenanceRule(a);

    uploadVersions(b, game, [
      version('backup-1.zip', 'h1', when(w)),
      version('backup-2.zip', 'h2', when(w, HOUR_MS)),
    ]);
    await settle(w);
    assert.deepEqual(liveBackupNames(a, game), ['backup-1.zip', 'backup-2.zip']);

    // A borra la v1 de B desde su ficha (el objeto del bucket se borraría antes).
    const v1 = listSaveBackups(a.ctx, game).find((row) => row.backupName === 'backup-1.zip');
    assert.ok(v1);
    assert.equal(v1.id, saveBackupId(keyOf(b, game, 'backup-1.zip')));
    const plan = planSaveBackupDeletion(a.ctx, v1.id, game);
    assert.ok(plan);
    assert.equal(plan.isOwn, false);
    assert.equal(plan.deviceId, b.deviceId);
    assert.equal(deletePlannedSaveBackups(a.ctx, plan), 1);
    await settle(w);
    assert.deepEqual(listOwnDeletedBackupNames(b.ctx, game), ['backup-1.zip']);

    // El siguiente backup de B: su carpeta aún tiene el zip de v1, más v3 nueva.
    w.advance(2 * HOUR_MS);
    const next = uploadVersions(b, game, [
      version('backup-1.zip', 'h1', when(w, -2 * HOUR_MS)),
      version('backup-2.zip', 'h2', when(w, -HOUR_MS)),
      version('backup-3.zip', 'h3', when(w)),
    ]);
    assert.deepEqual(next.skippedDeleted, ['backup-1.zip']);
    assert.deepEqual(
      next.created.map((row) => row.backupName),
      ['backup-3.zip'],
    );
    assert.deepEqual(listOwnDeletedBackupNames(b.ctx, game), ['backup-1.zip']);

    await settle(w);
    for (const client of [a, b]) {
      assert.deepEqual(liveBackupNames(client, game), ['backup-2.zip', 'backup-3.zip']);
    }
    const v1Id = saveBackupId(keyOf(b, game, 'backup-1.zip'));
    assert.notEqual(w.hubRaw('save_backups', v1Id)?.syncDeleted ?? null, null, 'lápida en el hub');
    assert.deepEqual(diffAgainstHub(w), []);
  });

  it('sin la regla R-13 registrada, borrar una versión ajena falla con not_owner', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 505, { title: 'Moss Library II' });
    await settle(w);
    uploadVersions(b, game, [version('backup-1.zip', 'h1', when(w))]);
    await settle(w);
    const row = listSaveBackups(a.ctx, game)[0];
    const plan = planSaveBackupDeletion(a.ctx, row.id, game);
    assert.ok(plan);
    assert.throws(
      () => deletePlannedSaveBackups(a.ctx, plan),
      (error: unknown) => isStoreError(error) && error.code === 'not_owner',
    );
  });
});

describe('E-20: la carpeta de datos de A se copia a B', () => {
  it('el valor de instalación publicado detecta el id duplicado y no se pisa', () => {
    // Cada cliente del arnés tiene su deviceId, así que aquí se usan bases en
    // fichero: la "carpeta de datos de A" se copia tal cual y sigue teniendo
    // el MISMO deviceId. La decisión de qué hacer con el conflicto (bloquear
    // poda y backups) no la toma `reconcileOwnSaveBackups`: el orquestador
    // llama a `assertInstallIdentity` ANTES de escribir en el bucket (eso se
    // prueba en src/main/saves/__tests__). Aquí se comprueba la detección.
    const dir = tempDir();
    try {
      const wall = fakeWall(T0);
      const open = (path: string): ReturnType<typeof openTestDb> =>
        openTestDb({ path, deviceId: LOCAL, wall: wall.wall });
      const contextOf = (
        local: ReturnType<typeof openTestDb>,
      ): ReturnType<typeof createQueryContext> =>
        createQueryContext(local, { now: () => new Date(wall.wall()) });
      const original = join(dir.path, 'a', 'afterplay.db');
      const copy = join(dir.path, 'b', 'afterplay.db');
      mkdirSync(join(dir.path, 'a'), { recursive: true });
      mkdirSync(join(dir.path, 'b'), { recursive: true });

      const dbA = open(original);
      const ctxA = contextOf(dbA);
      ensureThisDevice(ctxA, {
        name: 'PC-A',
        home: 'C:\\Users\\ana',
        appVersion: '2.0.0-test',
        schemaVersion: 1,
        now: ctxA.now(),
      });
      assert.equal(checkInstallNonce(ctxA, 'nonce-de-a'), 'published');
      assert.equal(checkInstallNonce(ctxA, 'nonce-de-a'), 'same');
      dbA.db.$client.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      dbA.close();

      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(original + suffix)) copyFileSync(original + suffix, copy + suffix);
      }

      // B: la carpeta copiada, con su propio valor de instalación.
      const dbB = open(copy);
      const ctxB = contextOf(dbB);
      assert.equal(readPublishedInstallNonce(ctxB), 'nonce-de-a');
      assert.equal(checkInstallNonce(ctxB, 'nonce-de-b'), 'conflict');
      assert.equal(
        readPublishedInstallNonce(ctxB),
        'nonce-de-a',
        'el conflicto no pisa el publicado',
      );
      assert.equal(checkInstallNonce(ctxB, 'nonce-de-b'), 'conflict');
      dbB.close();

      // El original sigue siendo el original.
      const dbA2 = open(original);
      assert.equal(checkInstallNonce(contextOf(dbA2), 'nonce-de-a'), 'same');
      dbA2.close();
    } finally {
      dir.cleanup();
    }
  });
});
