import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { isStoreError, type CreateValues } from '../../../store';
import { OTHER, asOtherDevice, seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import { saveMaintenanceForeignWriteRule, withSaveMaintenance } from '../maintenanceRule';
import { openSavesDb } from './fixture';

// R-13: la excepción a la regla del dueño solo vale para las tres rutas de
// mantenimiento del bucket, y solo para lo que cada una declara. Todo lo demás
// sigue prohibido aunque la regla esté registrada. Datos inventados.

let fx: QueryFixture;
afterEach(() => fx.close());

const THIRD = '0194c2f0-dddd-7000-8000-00000000000d';

function foreignBackupValues(
  gameId: string,
  deviceId: string,
  name: string,
): CreateValues<'save_backups'> {
  return {
    gameId,
    deviceId,
    backupName: name,
    r2Key: `saves/1/${deviceId}/${name}`,
    ludusaviName: 'Juego Inventado',
    createdAt: fx.ctx.now(),
  };
}

const notOwner = (error: unknown): boolean => isStoreError(error, 'not_owner');

describe('regla de mantenimiento de partidas (R-13)', () => {
  it('fuera de una ruta, crear o borrar una copia ajena sigue prohibido', () => {
    fx = openSavesDb();
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    const id = other.seedSaveBackup({ gameId });
    assert.throws(
      () => fx.ctx.store.create('save_backups', foreignBackupValues(gameId, OTHER, 'b.zip')),
      notOwner,
    );
    assert.throws(() => fx.ctx.store.remove('save_backups', id), notOwner);
  });

  it('al recuperar: crear las de las máquinas declaradas, nada más', () => {
    fx = openSavesDb();
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    asOtherDevice(fx.ctx, { deviceId: THIRD, name: 'PC-C' });
    const existing = other.seedSaveBackup({ gameId });

    withSaveMaintenance('recover_index', [OTHER], () => {
      fx.ctx.store.create('save_backups', foreignBackupValues(gameId, OTHER, 'nuevo.zip'));
      // Otra máquina que la ruta no ha declarado.
      assert.throws(
        () => fx.ctx.store.create('save_backups', foreignBackupValues(gameId, THIRD, 'c.zip')),
        notOwner,
      );
      // Recuperar no borra ni edita.
      assert.throws(() => fx.ctx.store.remove('save_backups', existing), notOwner);
      assert.throws(
        () => fx.ctx.store.patch('save_backups', existing, { sizeBytes: 99 }),
        notOwner,
      );
    });
  });

  it('al borrar una máquina o una versión ajena: borrar las suyas, no crear ni editar', () => {
    fx = openSavesDb();
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    const third = asOtherDevice(fx.ctx, { deviceId: THIRD, name: 'PC-C' });
    const mine = other.seedSaveBackup({ gameId });
    const theirs = third.seedSaveBackup({ gameId });

    for (const route of ['delete_machine', 'delete_backup'] as const) {
      withSaveMaintenance(route, [OTHER], () => {
        assert.throws(() => fx.ctx.store.remove('save_backups', theirs), notOwner);
        assert.throws(
          () => fx.ctx.store.create('save_backups', foreignBackupValues(gameId, OTHER, 'x.zip')),
          notOwner,
        );
        assert.throws(() => fx.ctx.store.patch('save_backups', mine, { sizeBytes: 1 }), notOwner);
      });
    }
    withSaveMaintenance('delete_machine', [OTHER], () => {
      fx.ctx.store.remove('save_backups', mine);
    });
  });

  it('ni dentro de una ruta se tocan otras tablas de otro dispositivo', () => {
    fx = openSavesDb();
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    const install = other.seedInstall({ gameId });
    withSaveMaintenance('delete_machine', [OTHER], () => {
      assert.throws(() => fx.ctx.store.remove('game_installs', install), notOwner);
    });
    withSaveMaintenance('recover_index', [OTHER], () => {
      assert.throws(
        () =>
          fx.ctx.store.create('game_installs', {
            gameId,
            deviceId: OTHER,
            executablePath: 'D:/x.exe',
          }),
        notOwner,
      );
    });
  });

  it('sin registrar la regla, ni las rutas pueden (falla con not_owner)', () => {
    fx = openSavesDb({ withRule: false });
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const id = asOtherDevice(fx.ctx).seedSaveBackup({ gameId });
    withSaveMaintenance('delete_machine', [OTHER], () => {
      assert.throws(() => fx.ctx.store.remove('save_backups', id), notOwner);
    });
  });

  it('el ámbito se cierra al terminar, también si falla, y no se anida', () => {
    fx = openSavesDb();
    const write = {
      kind: 'remove' as const,
      table: 'save_backups' as const,
      row: { deviceId: OTHER },
    };
    assert.equal(saveMaintenanceForeignWriteRule(write), false);
    assert.equal(
      withSaveMaintenance('delete_machine', [OTHER], () => saveMaintenanceForeignWriteRule(write)),
      true,
    );
    assert.equal(saveMaintenanceForeignWriteRule(write), false);
    assert.throws(() =>
      withSaveMaintenance('delete_machine', [OTHER], () => {
        throw new Error('fallo');
      }),
    );
    assert.equal(saveMaintenanceForeignWriteRule(write), false);
    assert.throws(() =>
      withSaveMaintenance('delete_machine', [OTHER], () =>
        withSaveMaintenance('recover_index', [OTHER], () => true),
      ),
    );
    assert.throws(() => withSaveMaintenance('delete_machine', [OTHER], async () => true));
    assert.equal(saveMaintenanceForeignWriteRule(write), false);
  });
});
