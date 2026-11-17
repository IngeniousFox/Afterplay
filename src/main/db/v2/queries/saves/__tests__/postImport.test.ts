import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { localLegacyIds, localSaveState } from '../../../schema';
import { OTHER, asOtherDevice, seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import { getLastSyncedHash, getSaveRestoreTarget, setLastSyncedHash } from '../localState';
import {
  getDeviceHome,
  getSaveReindexError,
  isSaveReindexPending,
  markSaveReindexPending,
  recordSaveReindexRun,
  remapLegacyRestoreTargets,
  seedOwnLastSyncedHashes,
} from '../postImport';
import { openSavesDb } from './fixture';

// Estado posterior a la importación: marcador de reindexado, siembra de
// lastSyncedHash y remapeo de machine-saves.json. Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

describe('marcador de reindexado pendiente', () => {
  it('sin marcar no hay nada pendiente', () => {
    assert.equal(isSaveReindexPending(fx.ctx), false);
  });

  it('marcar lo deja pendiente; un fallo lo mantiene y un éxito lo cierra', () => {
    markSaveReindexPending(fx.ctx);
    assert.equal(isSaveReindexPending(fx.ctx), true);

    recordSaveReindexRun(fx.ctx, { ok: false, error: 'sin red' });
    assert.equal(isSaveReindexPending(fx.ctx), true);
    assert.equal(getSaveReindexError(fx.ctx), 'sin red');

    recordSaveReindexRun(fx.ctx, { ok: true });
    assert.equal(isSaveReindexPending(fx.ctx), false);
    assert.equal(getSaveReindexError(fx.ctx), null);
  });

  it('marcar dos veces no duplica, y una importación nueva reabre el trabajo', () => {
    markSaveReindexPending(fx.ctx);
    markSaveReindexPending(fx.ctx);
    recordSaveReindexRun(fx.ctx, { ok: true });
    markSaveReindexPending(fx.ctx);
    assert.equal(isSaveReindexPending(fx.ctx), true);
  });
});

describe('seedOwnLastSyncedHashes', () => {
  const addOwn = (gameId: string, name: string, hash: string | null): void => {
    fx.wall.advance(1_000);
    fx.ctx.store.create('save_backups', {
      gameId,
      deviceId: fx.ctx.deviceId,
      backupName: name,
      r2Key: `saves/${gameId}/${fx.ctx.deviceId}/${name}`,
      ludusaviName: 'Celeste',
      createdAt: fx.ctx.now(),
      ...(hash ? { contentHash: hash } : {}),
    });
  };

  it('toma la huella de la copia más reciente de ESTE dispositivo, ignorando las de otros', () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    addOwn(game, 'backup-1.zip', 'h-vieja');
    addOwn(game, 'backup-2.zip', 'h-nueva');
    const other = asOtherDevice(fx.ctx);
    fx.wall.advance(1_000);
    other.seedSaveBackup({ gameId: game, contentHash: 'h-ajena-mas-reciente' });

    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 1);
    assert.equal(getLastSyncedHash(fx.ctx, game), 'h-nueva');
  });

  it('un juego sin copia propia queda sin huella', () => {
    const game = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    const other = asOtherDevice(fx.ctx);
    other.seedSaveBackup({ gameId: game, contentHash: 'h-ajena' });

    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 0);
    assert.equal(getLastSyncedHash(fx.ctx, game), null);
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 0);
  });

  it('si la más reciente no tiene huella no se usa una anterior (linaje falso)', () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    addOwn(game, 'backup-1.zip', 'h-vieja');
    addOwn(game, 'backup-2.zip', null);

    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 0);
    assert.equal(getLastSyncedHash(fx.ctx, game), null);
  });

  it('es idempotente y no pisa una huella ya existente', () => {
    const a = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const b = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    addOwn(a, 'backup-1.zip', 'h-a');
    addOwn(b, 'backup-1.zip', 'h-b');
    setLastSyncedHash(fx.ctx, b, 'h-posterior');

    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 1);
    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 0);
    assert.equal(getLastSyncedHash(fx.ctx, a), 'h-a');
    assert.equal(getLastSyncedHash(fx.ctx, b), 'h-posterior');
  });

  it('no siembra los juegos borrados', () => {
    const game = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    addOwn(game, 'backup-1.zip', 'h-a');
    fx.ctx.store.remove('games', game);

    assert.equal(seedOwnLastSyncedHashes(fx.ctx), 0);
  });
});

describe('remapLegacyRestoreTargets', () => {
  const link = (legacyId: number, newId: string): void => {
    fx.ctx.db.insert(localLegacyIds).values({ legacyTable: 'games', legacyId, newId }).run();
  };

  it('usa local_legacy_ids para llegar al id 2.0', () => {
    const withIgdb = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const manual = seedGame(fx.ctx, { title: 'Manual' });
    link(3, withIgdb);
    link(7, manual);

    const moved = remapLegacyRestoreTargets(fx.ctx, [
      ['3', 'D:\\Saves\\Celeste\\'],
      ['7', 'E:/Saves/Manual'],
    ]);

    assert.equal(moved, 2);
    assert.equal(getSaveRestoreTarget(fx.ctx, withIgdb)?.target, 'D:/Saves/Celeste');
    assert.equal(getSaveRestoreTarget(fx.ctx, manual)?.target, 'E:/Saves/Manual');
  });

  it('ignora ids no numéricos, desconocidos, borrados, y no pisa un destino existente', () => {
    const live = seedGame(fx.ctx, { title: 'Vivo', igdbId: 1 });
    const gone = seedGame(fx.ctx, { title: 'Borrado', igdbId: 2 });
    const kept = seedGame(fx.ctx, { title: 'Ya elegido', igdbId: 3 });
    link(1, live);
    link(2, gone);
    link(3, kept);
    fx.ctx.store.remove('games', gone);
    fx.ctx.db.insert(localSaveState).values({ gameId: kept, restoreTarget: 'X:/ya' }).run();

    const moved = remapLegacyRestoreTargets(fx.ctx, [
      ['abc', 'D:/a'],
      ['-4', 'D:/b'],
      ['99', 'D:/desconocido'],
      ['2', 'D:/borrado'],
      ['3', 'D:/pisar'],
      ['1', 'D:/vivo'],
    ]);

    assert.equal(moved, 1);
    assert.equal(getSaveRestoreTarget(fx.ctx, live)?.target, 'D:/vivo');
    assert.equal(getSaveRestoreTarget(fx.ctx, gone), null);
    assert.equal(getSaveRestoreTarget(fx.ctx, kept)?.target, 'X:/ya');
  });
});

describe('getDeviceHome', () => {
  it('lee la carpeta de usuario del dispositivo', () => {
    assert.equal(getDeviceHome(fx.ctx, fx.ctx.deviceId), 'C:/Users/ana');
    assert.equal(getDeviceHome(fx.ctx, OTHER), null);
  });
});
