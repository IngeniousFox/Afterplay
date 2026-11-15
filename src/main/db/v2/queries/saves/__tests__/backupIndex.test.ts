import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  OTHER,
  asOtherDevice,
  at,
  insertSynced,
  seedGame,
  seedSaveBackup,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  getLatestSaveBackup,
  getSaveBackup,
  getSaveBackupsUsage,
  hasIndexedSaveBackups,
  listIndexedSaveObjectKeys,
  listKnownLudusaviNames,
  listOwnBackupEntries,
  listSaveBackups,
} from '../backupIndex';
import { openSavesDb } from './fixture';

// Lecturas del índice de partidas. Porta lo que `localUsage.test.ts` y
// `verifyStorageRestore.test.ts` esperan de la base (allí con la consulta
// simulada). Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

describe('listSaveBackups', () => {
  it('copias de todos los PCs, la más reciente (por reloj de sync) primero, con nombre y carpeta del dispositivo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx, { name: 'PC-B', home: 'C:/Users/bea' });
    const old = seedSaveBackup(fx.ctx, { gameId, backupName: 'a.zip', createdAt: at(1_000) });
    // El orden es el del reloj de sync (§12.5): la copia de PC-B se registra después.
    fx.wall.advance(1_000);
    const recent = other.seedSaveBackup({ gameId, backupName: 'b.zip', createdAt: at(2_000) });

    const rows = listSaveBackups(fx.ctx, gameId);
    assert.deepEqual(
      rows.map((row) => row.id),
      [recent, old],
    );
    assert.equal(rows[0].machineId, OTHER);
    assert.equal(rows[0].machineName, 'PC-B');
    assert.equal(rows[0].machineHome, 'C:/Users/bea');
    assert.equal(rows[1].machineId, fx.ctx.deviceId);
    assert.equal(rows[1].machineName, 'PC-A');
  });

  it('home desconocido sale como cadena vacía (no redirigir)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const deviceId = '0194c2f0-eeee-7000-8000-00000000000e';
    fx.ctx.store.create('devices', {
      id: deviceId,
      name: 'PC-E',
      kind: 'desktop',
      os: 'windows',
      firstSeenAt: fx.ctx.now(),
    });
    const id = insertSynced(fx.ctx, 'save_backups', {
      gameId,
      deviceId,
      backupName: 'e.zip',
      r2Key: `saves/1/${deviceId}/e.zip`,
      ludusaviName: 'Celeste',
      createdAt: fx.ctx.now(),
    });
    const row = getSaveBackup(fx.ctx, id);
    assert.equal(row?.machineName, 'PC-E');
    assert.equal(row?.machineHome, '');
  });

  it('ni copias con lápida ni copias de un juego borrado (F-11, como la cascada de la 1.x)', () => {
    const alive = seedGame(fx.ctx, { title: 'Celeste' });
    const deleted = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const gone = seedSaveBackup(fx.ctx, { gameId: alive, backupName: 'gone.zip' });
    seedSaveBackup(fx.ctx, { gameId: deleted, backupName: 'x.zip' });
    fx.ctx.store.remove('save_backups', gone);
    tombstoneOnly(fx.ctx, 'games', deleted);

    assert.deepEqual(listSaveBackups(fx.ctx, alive), []);
    assert.deepEqual(listSaveBackups(fx.ctx, deleted), []);
    assert.equal(getSaveBackup(fx.ctx, gone), null);
  });

  it('getSaveBackup exige el juego indicado', () => {
    const a = seedGame(fx.ctx, { title: 'Celeste' });
    const b = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const id = seedSaveBackup(fx.ctx, { gameId: a });
    assert.equal(getSaveBackup(fx.ctx, id, a)?.id, id);
    assert.equal(getSaveBackup(fx.ctx, id, b), null);
  });
});

describe('uso de la nube e índice no vacío', () => {
  it('suma y cuenta las copias vivas de juegos vivos', () => {
    assert.deepEqual(getSaveBackupsUsage(fx.ctx), { totalBytes: 0, backupCount: 0 });
    assert.equal(hasIndexedSaveBackups(fx.ctx), false);

    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const deleted = seedGame(fx.ctx, { title: 'Hollow Knight' });
    seedSaveBackup(fx.ctx, { gameId, backupName: 'a.zip', sizeBytes: 100 });
    asOtherDevice(fx.ctx).seedSaveBackup({ gameId, backupName: 'b.zip', sizeBytes: 50 });
    const gone = seedSaveBackup(fx.ctx, { gameId, backupName: 'c.zip', sizeBytes: 7 });
    fx.ctx.store.remove('save_backups', gone);
    seedSaveBackup(fx.ctx, { gameId: deleted, backupName: 'd.zip', sizeBytes: 1_000 });
    fx.ctx.store.remove('games', deleted);

    assert.deepEqual(getSaveBackupsUsage(fx.ctx), { totalBytes: 150, backupCount: 2 });
    assert.equal(hasIndexedSaveBackups(fx.ctx), true);
  });
});

describe('índice local para localUsage', () => {
  it('listOwnBackupEntries: solo las de ESTE PC, vivas y de juegos vivos', () => {
    const gameId = seedGame(fx.ctx, { title: 'Alive Game' });
    const deleted = seedGame(fx.ctx, { title: 'Stale Game' });
    seedSaveBackup(fx.ctx, {
      gameId,
      backupName: 'backup-1.zip',
      ludusaviName: 'Alive Game',
      sizeBytes: 1000,
    });
    asOtherDevice(fx.ctx).seedSaveBackup({ gameId, backupName: 'ajena.zip' });
    seedSaveBackup(fx.ctx, { gameId: deleted, backupName: 'old.zip', ludusaviName: 'Stale Game' });
    fx.ctx.store.remove('games', deleted);

    assert.deepEqual(listOwnBackupEntries(fx.ctx), [
      { ludusaviName: 'Alive Game', backupName: 'backup-1.zip', sizeBytes: 1000 },
    ]);
  });

  it('listKnownLudusaviNames: índice de cualquier PC ∪ juegos vivos (planeados incluidos)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Game A', saveLudusaviName: 'Game A' });
    seedGame(fx.ctx, { title: 'Game P', saveLudusaviName: 'Game P', planned: true });
    const deletedGame = seedGame(fx.ctx, { title: 'Game D', saveLudusaviName: 'Game D' });
    seedGame(fx.ctx, { title: 'Sin nombre' });
    asOtherDevice(fx.ctx).seedSaveBackup({ gameId, ludusaviName: 'Game B' });
    const gone = seedSaveBackup(fx.ctx, { gameId, backupName: 'g.zip', ludusaviName: 'Ghost' });
    fx.ctx.store.remove('save_backups', gone);
    // Copia de un juego borrado: su fila sigue viva (`keep`) y su carpeta local
    // no se trata como huérfana (ante la duda, no borrar).
    seedSaveBackup(fx.ctx, { gameId: deletedGame, backupName: 'k.zip', ludusaviName: 'Kept' });
    fx.ctx.store.remove('games', deletedGame);

    assert.deepEqual(listKnownLudusaviNames(fx.ctx).sort(), ['Game A', 'Game B', 'Game P', 'Kept']);
  });
});

describe('claves conocidas y copia más reciente', () => {
  it('listIndexedSaveObjectKeys: claves de copias vivas de juegos vivos', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedSaveBackup(fx.ctx, { gameId, backupName: 'a', r2Key: 'saves/1/m/a.zip' });
    const gone = seedSaveBackup(fx.ctx, { gameId, backupName: 'b', r2Key: 'saves/1/m/b.zip' });
    fx.ctx.store.remove('save_backups', gone);
    assert.deepEqual([...listIndexedSaveObjectKeys(fx.ctx)], ['saves/1/m/a.zip']);
  });

  it('getLatestSaveBackup: la más reciente de cualquier PC (verifyStorageRestore)', () => {
    assert.equal(getLatestSaveBackup(fx.ctx), null);
    const gameId = seedGame(fx.ctx, { title: 'Test Game' });
    seedSaveBackup(fx.ctx, { gameId, backupName: 'backup-full.zip', createdAt: at(1_000) });
    asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      backupName: 'backup-diff.zip',
      parentBackupName: 'backup-full.zip',
      differential: true,
      r2Key: 'saves/1/machine/backup-diff.zip',
      ludusaviName: 'Test Game',
      createdAt: at(2_000),
    });
    assert.deepEqual(getLatestSaveBackup(fx.ctx), {
      r2Key: 'saves/1/machine/backup-diff.zip',
      backupName: 'backup-diff.zip',
      parentBackupName: 'backup-full.zip',
      ludusaviName: 'Test Game',
    });
  });
});
