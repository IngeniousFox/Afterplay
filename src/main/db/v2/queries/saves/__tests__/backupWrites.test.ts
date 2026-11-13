import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { saveBackupId } from '../../../../../../shared/sync/ids';
import { count, rawRow } from '../../../__tests__/helpers';
import { isStoreError } from '../../../store';
import {
  OTHER,
  asOtherDevice,
  at,
  day,
  seedGame,
  seedSaveBackup,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { listSaveBackups } from '../backupIndex';
import {
  deleteDeviceSaveBackups,
  deletePlannedSaveBackups,
  deleteSaveBackups,
  planSaveBackupDeletion,
  reconcileOwnSaveBackups,
  recoverSaveBackups,
  type NewOwnSaveBackup,
  type RecoveredSaveBackup,
} from '../backupWrites';
import { saveObjectKey } from '../objectKey';
import { openSavesDb } from './fixture';

// Escrituras del índice de partidas. Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

const THIRD = '0194c2f0-dddd-7000-8000-00000000000d';

const version = (backupName: string, extra: Partial<NewOwnSaveBackup> = {}): NewOwnSaveBackup => ({
  backupName,
  createdAt: at(1_000),
  sizeBytes: 100,
  ludusaviName: 'Celeste',
  differential: false,
  parentBackupName: null,
  locations: ['<home>/Saves'],
  hasRegistry: false,
  ...extra,
});

const ownKey = (backupName: string): string =>
  saveObjectKey({ saveKey: '26226', deviceId: fx.ctx.deviceId, backupName });

describe('reconcileOwnSaveBackups (syncGameToR2, paso 4)', () => {
  it('da de alta las versiones nuevas con id = UUIDv5 de la clave y relee las filas', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const result = reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: () => false,
      versions: [version('backup-1.zip'), version('backup-2.zip', { createdAt: null })],
    });
    assert.equal(result.gameAlive, true);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(
      result.created.map((row) => row.id).sort(),
      [saveBackupId(ownKey('backup-1.zip')), saveBackupId(ownKey('backup-2.zip'))].sort(),
    );
    const second = result.created.find((row) => row.backupName === 'backup-2.zip');
    assert.equal(second?.r2Key, ownKey('backup-2.zip'));
    assert.equal(second?.createdAt.getTime(), fx.ctx.now().getTime()); // sin fecha: ahora
    assert.equal(second?.machineId, fx.ctx.deviceId);
    assert.equal(second?.machineName, 'PC-A');
    const raw = rawRow(fx.local, 'save_backups', second?.id ?? '');
    assert.equal(raw?.contentHash, null); // fase 6
    assert.equal(raw?.parentContentHash, null);
  });

  it('registrar dos veces la misma versión no duplica (F-21)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const input = {
      gameId,
      saveKey: '26226',
      isStale: () => false,
      versions: [version('backup-1.zip')],
    };
    reconcileOwnSaveBackups(fx.ctx, input);
    const again = reconcileOwnSaveBackups(fx.ctx, input);
    assert.deepEqual(again.created, []);
    assert.equal(count(fx.local, 'save_backups'), 1);
  });

  it('poda solo las filas PROPIAS caducadas; las del otro PC no se leen', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: () => false,
      versions: [version('old.zip'), version('keep.zip')],
    });
    const theirs = asOtherDevice(fx.ctx).seedSaveBackup({ gameId, backupName: 'old.zip' });
    const seen: string[] = [];
    const result = reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: (row) => {
        seen.push(row.backupName);
        return row.backupName === 'old.zip';
      },
      versions: [version('keep.zip'), version('new.zip')],
    });
    assert.deepEqual(seen.sort(), ['keep.zip', 'old.zip']);
    assert.deepEqual(result.removed, [saveBackupId(ownKey('old.zip'))]);
    assert.deepEqual(
      result.created.map((row) => row.backupName),
      ['new.zip'],
    );
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId)
        .map((row) => row.backupName)
        .sort(),
      [
        'keep.zip',
        'new.zip',
        'old.zip', // la del otro PC
      ],
    );
    assert.ok(listSaveBackups(fx.ctx, gameId).some((row) => row.id === theirs));
  });

  it('con versions null poda pero no indexa (mapping.yaml sin fusionar)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: () => false,
      versions: [version('old.zip')],
    });
    const result = reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: () => true,
      versions: null,
    });
    assert.equal(result.removed.length, 1);
    assert.deepEqual(listSaveBackups(fx.ctx, gameId), []);
  });

  it('una versión borrada con el zip aún en la carpeta resucita (como hoy la reinsertaba)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const input = {
      gameId,
      saveKey: '26226',
      isStale: () => false,
      versions: [version('b.zip')],
    };
    const [row] = reconcileOwnSaveBackups(fx.ctx, input).created;
    fx.ctx.store.remove('save_backups', row.id);
    assert.equal(reconcileOwnSaveBackups(fx.ctx, input).created[0]?.id, row.id);
  });

  it('juego borrado: no escribe nada (R-15)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    fx.ctx.store.remove('games', gameId);
    const result = reconcileOwnSaveBackups(fx.ctx, {
      gameId,
      saveKey: '26226',
      isStale: () => true,
      versions: [version('b.zip')],
    });
    assert.deepEqual(result, { gameAlive: false, removed: [], created: [] });
    assert.equal(count(fx.local, 'save_backups'), 0);
  });

  it('un prefijo que no es el del juego es un error', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    assert.throws(
      () =>
        reconcileOwnSaveBackups(fx.ctx, {
          gameId,
          saveKey: '1',
          isStale: () => false,
          versions: [version('b.zip')],
        }),
      (error) => isStoreError(error, 'invalid_value'),
    );
  });
});

describe('deleteSaveBackups (propias)', () => {
  it('borra las propias y salta las que no existen o ya tenían lápida', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const a = seedSaveBackup(fx.ctx, { gameId, backupName: 'a' });
    const b = seedSaveBackup(fx.ctx, { gameId, backupName: 'b' });
    fx.ctx.store.remove('save_backups', b);
    assert.equal(deleteSaveBackups(fx.ctx, [a, b, 'no-existe']), 1);
    assert.equal(deleteSaveBackups(fx.ctx, []), 0);
  });

  it('una ajena propaga not_owner y no borra nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const mine = seedSaveBackup(fx.ctx, { gameId, backupName: 'a' });
    const theirs = asOtherDevice(fx.ctx).seedSaveBackup({ gameId });
    assert.throws(
      () => deleteSaveBackups(fx.ctx, [mine, theirs]),
      (error) => isStoreError(error, 'not_owner'),
    );
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 2);
  });
});

describe('saves:deleteBackup (plan + borrado)', () => {
  it('un completo arrastra sus diferenciales de la MISMA máquina, no los de otra', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const full = seedSaveBackup(fx.ctx, { gameId, backupName: 'full.zip' });
    const diff = seedSaveBackup(fx.ctx, {
      gameId,
      backupName: 'diff.zip',
      differential: true,
      parentBackupName: 'full.zip',
    });
    const foreignDiff = asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      backupName: 'diff.zip',
      differential: true,
      parentBackupName: 'full.zip',
    });

    const plan = planSaveBackupDeletion(fx.ctx, full, gameId);
    assert.ok(plan);
    assert.equal(plan.isOwn, true);
    assert.deepEqual(
      plan.doomed.map((row) => row.id),
      [full, diff],
    );
    assert.equal(deletePlannedSaveBackups(fx.ctx, plan), 2);
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.id),
      [foreignDiff],
    );
  });

  it('una versión de otro PC se borra (borrado cruzado, R-13) y solo la suya', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    const full = other.seedSaveBackup({ gameId, backupName: 'full.zip' });
    const diff = other.seedSaveBackup({
      gameId,
      backupName: 'diff.zip',
      differential: true,
      parentBackupName: 'full.zip',
    });
    const mine = seedSaveBackup(fx.ctx, { gameId, backupName: 'mine' });

    const plan = planSaveBackupDeletion(fx.ctx, full, gameId);
    assert.ok(plan);
    assert.equal(plan.isOwn, false);
    assert.equal(plan.deviceId, OTHER);
    assert.equal(deletePlannedSaveBackups(fx.ctx, plan), 2);
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.id),
      [mine],
    );
    // Lápida, no borrado físico: el dueño la verá (§12.5, fase 6).
    assert.notEqual(rawRow(fx.local, 'save_backups', diff)?.syncDeleted, null);
  });

  it('sin la regla registrada, borrar una versión ajena falla con not_owner', () => {
    fx.close();
    fx = openSavesDb({ withRule: false });
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const full = asOtherDevice(fx.ctx).seedSaveBackup({ gameId, backupName: 'full.zip' });
    const plan = planSaveBackupDeletion(fx.ctx, full, gameId);
    assert.ok(plan);
    assert.throws(
      () => deletePlannedSaveBackups(fx.ctx, plan),
      (error) => isStoreError(error, 'not_owner'),
    );
  });

  it('copia inexistente o de otro juego: null; filas ya borradas entre plan y borrado se saltan', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const otherGame = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const id = seedSaveBackup(fx.ctx, { gameId, backupName: 'a' });
    assert.equal(planSaveBackupDeletion(fx.ctx, id, otherGame), null);
    assert.equal(planSaveBackupDeletion(fx.ctx, 'no-existe', gameId), null);
    const plan = planSaveBackupDeletion(fx.ctx, id, gameId);
    assert.ok(plan);
    fx.ctx.store.remove('save_backups', id);
    assert.equal(deletePlannedSaveBackups(fx.ctx, plan), 0);
  });
});

describe('deleteDeviceSaveBackups (deleteMachineFromCloud)', () => {
  it('lápida a todas las copias de esa máquina, también de juegos borrados o planeados', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const planned = seedGame(fx.ctx, { title: 'Hades', planned: true });
    const deleted = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const other = asOtherDevice(fx.ctx);
    const third = asOtherDevice(fx.ctx, { deviceId: THIRD, name: 'PC-C' });
    other.seedSaveBackup({ gameId });
    other.seedSaveBackup({ gameId: planned });
    other.seedSaveBackup({ gameId: deleted });
    fx.ctx.store.remove('games', deleted);
    const keptThird = third.seedSaveBackup({ gameId });
    const keptMine = seedSaveBackup(fx.ctx, { gameId });

    assert.equal(deleteDeviceSaveBackups(fx.ctx, OTHER), 3);
    assert.equal(
      count(fx.local, 'save_backups', `deviceId = '${OTHER}' AND syncDeleted IS NULL`),
      0,
    );
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId)
        .map((row) => row.id)
        .sort(),
      [keptMine, keptThird].sort(),
    );
    // El dispositivo no se borra nunca.
    assert.ok(rawRow(fx.local, 'devices', OTHER));
  });

  it('este PC no: error invalid_value sin tocar nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedSaveBackup(fx.ctx, { gameId });
    assert.throws(
      () => deleteDeviceSaveBackups(fx.ctx, fx.ctx.deviceId),
      (error) => isStoreError(error, 'invalid_value'),
    );
    assert.equal(listSaveBackups(fx.ctx, gameId).length, 1);
  });

  it('sin la regla registrada falla con not_owner', () => {
    fx.close();
    fx = openSavesDb({ withRule: false });
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx).seedSaveBackup({ gameId });
    assert.throws(
      () => deleteDeviceSaveBackups(fx.ctx, OTHER),
      (error) => isStoreError(error, 'not_owner'),
    );
  });
});

describe('recoverSaveBackups (recoverIndexFromCloud)', () => {
  const recovered = (
    gameId: string,
    deviceId: string,
    backupName: string,
    extra: Partial<RecoveredSaveBackup> = {},
  ): RecoveredSaveBackup => ({
    gameId,
    r2Key: saveObjectKey({ saveKey: '26226', deviceId, backupName }),
    createdAt: day(1),
    sizeBytes: 300,
    ludusaviName: 'Celeste',
    differential: false,
    parentBackupName: null,
    locations: null,
    hasRegistry: false,
    ...extra,
  });

  it('crea la fila de devices de otra máquina antes de sus copias y las indexa', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const result = recoverSaveBackups(fx.ctx, {
      devices: [{ deviceId: OTHER, name: 'PC-B', home: 'C:/Users/bea' }],
      backups: [
        recovered(gameId, OTHER, 'b2.zip', { createdAt: day(3) }),
        recovered(gameId, OTHER, 'b1.zip', { createdAt: day(2) }),
        recovered(gameId, fx.ctx.deviceId, 'mine.zip'),
      ],
    });
    assert.deepEqual(result, { recovered: 3, alreadyIndexed: 0, skippedNoGame: 0 });

    const device = rawRow(fx.local, 'devices', OTHER);
    assert.equal(device?.name, 'PC-B');
    assert.equal(device?.home, 'C:/Users/bea');
    assert.equal(device?.kind, 'desktop');
    assert.equal(device?.os, 'windows');
    assert.equal(device?.firstSeenAt, day(2).getTime()); // la copia más antigua

    const rows = listSaveBackups(fx.ctx, gameId);
    assert.deepEqual(
      rows.map((row) => [row.backupName, row.machineName, row.machineHome]),
      [
        ['b2.zip', 'PC-B', 'C:/Users/bea'],
        ['b1.zip', 'PC-B', 'C:/Users/bea'],
        ['mine.zip', 'PC-A', 'C:/Users/ana'],
      ],
    );
    assert.equal(rows[0].id, saveBackupId(rows[0].r2Key));
  });

  it('sin manifiesto: "Unknown PC" y sin home; un dispositivo existente no se pisa', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    asOtherDevice(fx.ctx, { deviceId: THIRD, name: 'Mi portátil', home: 'C:/Users/carla' });
    recoverSaveBackups(fx.ctx, {
      devices: [{ deviceId: THIRD, name: 'Otro nombre', home: 'C:/Users/otra' }],
      backups: [recovered(gameId, OTHER, 'x.zip'), recovered(gameId, THIRD, 'y.zip')],
    });
    assert.equal(rawRow(fx.local, 'devices', OTHER)?.name, 'Unknown PC');
    assert.equal(rawRow(fx.local, 'devices', OTHER)?.home, null);
    assert.equal(rawRow(fx.local, 'devices', THIRD)?.name, 'Mi portátil');
    assert.equal(rawRow(fx.local, 'devices', THIRD)?.home, 'C:/Users/carla');
  });

  it('un dispositivo existente sin home lo gana del manifiesto', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    recoverSaveBackups(fx.ctx, { devices: [], backups: [recovered(gameId, OTHER, 'x.zip')] });
    recoverSaveBackups(fx.ctx, {
      devices: [{ deviceId: OTHER, name: 'PC-B', home: 'C:/Users/bea' }],
      backups: [recovered(gameId, OTHER, 'y.zip')],
    });
    assert.equal(rawRow(fx.local, 'devices', OTHER)?.name, 'Unknown PC');
    assert.equal(rawRow(fx.local, 'devices', OTHER)?.home, 'C:/Users/bea');
  });

  it('recuperar dos veces no duplica; una fila con lápida cuyo objeto sigue arriba resucita', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const input = {
      devices: [],
      backups: [recovered(gameId, OTHER, 'a.zip'), recovered(gameId, OTHER, 'b.zip')],
    };
    recoverSaveBackups(fx.ctx, input);
    const again = recoverSaveBackups(fx.ctx, input);
    assert.deepEqual(again, { recovered: 0, alreadyIndexed: 2, skippedNoGame: 0 });
    assert.equal(count(fx.local, 'save_backups'), 2);

    const [row] = listSaveBackups(fx.ctx, gameId);
    deleteDeviceSaveBackups(fx.ctx, OTHER);
    assert.deepEqual(recoverSaveBackups(fx.ctx, input), {
      recovered: 2,
      alreadyIndexed: 0,
      skippedNoGame: 0,
    });
    assert.equal(count(fx.local, 'save_backups'), 2);
    assert.ok(listSaveBackups(fx.ctx, gameId).some((candidate) => candidate.id === row.id));
  });

  it('juego borrado o inexistente: se salta (R-15) sin crear su dispositivo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    fx.ctx.store.remove('games', gameId);
    const result = recoverSaveBackups(fx.ctx, {
      devices: [],
      backups: [recovered(gameId, OTHER, 'a.zip'), recovered('no-existe', OTHER, 'b.zip')],
    });
    assert.deepEqual(result, { recovered: 0, alreadyIndexed: 0, skippedNoGame: 2 });
    assert.equal(rawRow(fx.local, 'devices', OTHER), undefined);
  });

  it('clave mal formada o de otro prefijo: invalid_value y no escribe nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const bad = (r2Key: string): void => {
      assert.throws(
        () =>
          recoverSaveBackups(fx.ctx, {
            devices: [],
            backups: [
              recovered(gameId, OTHER, 'ok.zip'),
              { ...recovered(gameId, OTHER, 'x'), r2Key },
            ],
          }),
        (error) => isStoreError(error, 'invalid_value'),
      );
    };
    bad('saves/26226/x.zip');
    bad(`saves/999/${OTHER}/x.zip`);
    assert.equal(count(fx.local, 'save_backups'), 0);
    assert.equal(rawRow(fx.local, 'devices', OTHER), undefined);
  });

  it('sin la regla registrada, las copias ajenas fallan con not_owner (las propias sí)', () => {
    fx.close();
    fx = openSavesDb({ withRule: false });
    const gameId = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    assert.equal(
      recoverSaveBackups(fx.ctx, {
        devices: [],
        backups: [recovered(gameId, fx.ctx.deviceId, 'mine.zip')],
      }).recovered,
      1,
    );
    assert.throws(
      () =>
        recoverSaveBackups(fx.ctx, { devices: [], backups: [recovered(gameId, OTHER, 'a.zip')] }),
      (error) => isStoreError(error, 'not_owner'),
    );
  });
});
