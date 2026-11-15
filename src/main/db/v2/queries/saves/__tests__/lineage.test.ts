import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, rawRow } from '../../../__tests__/helpers';
import { isStoreError } from '../../../store';
import { localSaveState } from '../../../schema';
import {
  OTHER,
  asOtherDevice,
  at,
  day,
  openQueryDb,
  seedGame,
  seedSaveBackup,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  listOwnDeletedBackupNames,
  listSaveBackups,
  listSaveLineage,
  UNKNOWN_DEVICE_NAME,
} from '../backupIndex';
import {
  purgeSaveFolderRows,
  reconcileOwnSaveBackups,
  recoverSaveBackups,
  saveKeyFolder,
  listSaveKeyGames,
  type NewOwnSaveBackup,
  type RecoveredSaveBackup,
} from '../backupWrites';
import {
  checkInstallNonce,
  forcePublishInstallNonce,
  readPublishedInstallNonce,
} from '../installNonce';
import {
  clearAllLastSyncedHashes,
  getLastSyncedHash,
  getSaveRestoreTarget,
  setLastSyncedHash,
  setSaveRestoreTarget,
} from '../localState';
import { saveBackupIdForKey, saveObjectKey } from '../objectKey';
import { openSavesDb } from './fixture';

// Fase 6: huella, linaje y limpieza de carpetas (§12.2-12.5, F-23, F-25).
// Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

const version = (backupName: string, extra: Partial<NewOwnSaveBackup> = {}): NewOwnSaveBackup => ({
  backupName,
  createdAt: at(1_000),
  sizeBytes: 100,
  ludusaviName: 'Celeste',
  differential: false,
  parentBackupName: null,
  locations: ['<home>/Saves'],
  hasRegistry: false,
  contentHash: null,
  ...extra,
});

const ownId = (backupName: string, saveKey = '26226'): string =>
  saveBackupIdForKey(saveObjectKey({ saveKey, deviceId: fx.ctx.deviceId, backupName }));

const celeste = (): string => seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });

const reconcile = (
  gameId: string,
  versions: NewOwnSaveBackup[] | null,
  isStale: (row: { backupName: string }) => boolean = () => false,
): ReturnType<typeof reconcileOwnSaveBackups> =>
  reconcileOwnSaveBackups(fx.ctx, { gameId, saveKey: '26226', isStale, versions });

const parentOf = (backupName: string): unknown =>
  rawRow(fx.local, 'save_backups', ownId(backupName))?.parentContentHash;
const hashOf = (backupName: string): unknown =>
  rawRow(fx.local, 'save_backups', ownId(backupName))?.contentHash;

describe('reconcileOwnSaveBackups: linaje (§12.3)', () => {
  it('encadena de la más antigua a la más nueva y mueve lastSyncedHash a la última', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    // Entregadas desordenadas: la cadena sigue el orden de las fechas.
    reconcile(gameId, [
      version('v3.zip', { createdAt: at(3_000), contentHash: 'h3' }),
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    assert.equal(parentOf('v1.zip'), 'h0'); // la primera, de lastSyncedHash
    assert.equal(parentOf('v2.zip'), 'h1');
    assert.equal(parentOf('v3.zip'), 'h2');
    assert.equal(hashOf('v3.zip'), 'h3');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h3');
  });

  it('sin lastSyncedHash la primera no tiene padre (se omite, no se inventa)', () => {
    const gameId = celeste();
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    assert.equal(parentOf('v1.zip'), null);
    assert.equal(parentOf('v2.zip'), 'h1');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
  });

  it('una segunda pasada continúa la cadena desde donde quedó', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    assert.equal(parentOf('v2.zip'), 'h1');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
  });

  it('una pasada sin nada nuevo no toca lastSyncedHash', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    setLastSyncedHash(fx.ctx, gameId, 'restaurada');
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'restaurada');
  });

  it('una subida tardía MÁS ANTIGUA que lo ya indexado no tiene padre ni mueve lastSyncedHash', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' })]);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');

    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    assert.equal(parentOf('v1.zip'), null);
    assert.equal(hashOf('v1.zip'), 'h1');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
  });

  it('una huella nula rompe la cadena: la siguiente no tiene padre', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: null }),
      version('v3.zip', { createdAt: at(3_000), contentHash: 'h3' }),
    ]);
    assert.equal(parentOf('v1.zip'), 'h0');
    assert.equal(parentOf('v2.zip'), 'h1'); // sabe de quién viene aunque no tenga huella
    assert.equal(hashOf('v2.zip'), null);
    assert.equal(parentOf('v3.zip'), null); // el eslabón anterior no tiene huella
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h3');
  });

  it('si la más nueva no tiene huella, lastSyncedHash pasa a null (no se sabe de qué parte el disco)', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: null }),
    ]);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
  });

  it('las filas con lápida cuentan como "ya indexadas": una versión más antigua que ellas no encadena', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' })]);
    // El usuario borra v2 (desde aquí o desde otro PC).
    fx.ctx.store.remove('save_backups', ownId('v2.zip'));
    setLastSyncedHash(fx.ctx, gameId, 'h2');

    const result = reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
    ]);
    assert.equal(result.created.length, 1);
    assert.equal(parentOf('v1.zip'), null);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
  });

  it('una versión borrada no resucita (skippedDeleted), no cambia lastSyncedHash y las nuevas siguen su cadena', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    fx.ctx.store.remove('save_backups', ownId('v1.zip'));
    setLastSyncedHash(fx.ctx, gameId, 'h1');

    const result = reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    assert.deepEqual(result.skippedDeleted, ['v1.zip']);
    assert.deepEqual(
      result.created.map((row) => row.backupName),
      ['v2.zip'],
    );
    assert.equal(parentOf('v2.zip'), 'h1');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
    // v1 sigue con lápida: no hay fila viva de ella.
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.backupName),
      ['v2.zip'],
    );
  });

  it('una versión borrada solo se avisa una vez aunque venga repetida', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { contentHash: 'h1' })]);
    fx.ctx.store.remove('save_backups', ownId('v1.zip'));
    const result = reconcile(gameId, [
      version('v1.zip', { contentHash: 'h1' }),
      version('v1.zip', { contentHash: 'h1' }),
    ]);
    assert.deepEqual(result.skippedDeleted, ['v1.zip']);
  });

  it('las copias de OTRO PC no cuentan para decidir qué es más reciente', () => {
    const gameId = celeste();
    // El otro PC subió algo más nuevo que lo que va a subir este.
    asOtherDevice(fx.ctx).seedSaveBackup({ gameId, createdAt: at(9_000), contentHash: 'hx' });
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h1');
  });

  it('podar filas caducadas no mueve la huella de partida', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' })]);
    setLastSyncedHash(fx.ctx, gameId, 'otra');
    const result = reconcile(gameId, [], (row) => row.backupName === 'v1.zip');
    assert.equal(result.removed.length, 1);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'otra');
  });

  it('con versions null no se indexa ni se mueve nada', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    const result = reconcile(gameId, null);
    assert.deepEqual(result.created, []);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h0');
  });

  it('juego borrado: no se escribe nada y lastSyncedHash no se toca', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    fx.ctx.store.remove('games', gameId);
    const result = reconcile(gameId, [version('v1.zip', { contentHash: 'h1' })]);
    assert.equal(result.gameAlive, false);
    assert.equal(count(fx.local, 'save_backups'), 0);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h0');
  });

  it('es atómica: si una versión no forma una clave válida no queda ni una fila ni se mueve la huella', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    assert.throws(
      () =>
        reconcile(gameId, [
          version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
          version('a/b.zip', { createdAt: at(2_000), contentHash: 'h2' }),
        ]),
      (error) => isStoreError(error, 'invalid_value'),
    );
    assert.equal(count(fx.local, 'save_backups'), 0);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h0');
  });
});

describe('recoverSaveBackups: huella y orden', () => {
  const recovered = (
    gameId: string,
    backupName: string,
    extra: Partial<RecoveredSaveBackup> = {},
  ): RecoveredSaveBackup => ({
    gameId,
    r2Key: saveObjectKey({ saveKey: '26226', deviceId: OTHER, backupName }),
    createdAt: at(1_000),
    sizeBytes: 10,
    ludusaviName: 'Celeste',
    differential: false,
    parentBackupName: null,
    locations: null,
    hasRegistry: false,
    ...extra,
  });

  it('guarda la huella si viene y la omite si no; el linaje nunca se recupera', () => {
    const gameId = celeste();
    recoverSaveBackups(fx.ctx, {
      devices: [{ deviceId: OTHER, name: 'PC-B', home: 'C:/Users/bea' }],
      backups: [
        recovered(gameId, 'con.zip', { contentHash: 'hh' }),
        recovered(gameId, 'sin.zip'),
        recovered(gameId, 'nula.zip', { contentHash: null }),
        recovered(gameId, 'vacia.zip', { contentHash: '' }),
      ],
    });
    const hashOfOther = (name: string): ReturnType<typeof rawRow> =>
      rawRow(
        fx.local,
        'save_backups',
        saveBackupIdForKey(saveObjectKey({ saveKey: '26226', deviceId: OTHER, backupName: name })),
      );
    assert.equal(hashOfOther('con.zip')?.contentHash, 'hh');
    assert.equal(hashOfOther('sin.zip')?.contentHash, null);
    assert.equal(hashOfOther('nula.zip')?.contentHash, null);
    assert.equal(hashOfOther('vacia.zip')?.contentHash, null);
    for (const name of ['con.zip', 'sin.zip', 'nula.zip', 'vacia.zip']) {
      assert.equal(hashOfOther(name)?.parentContentHash, null);
    }
  });

  it('se insertan de la más antigua a la más nueva (reloj de sync), vengan como vengan', () => {
    const gameId = celeste();
    recoverSaveBackups(fx.ctx, {
      devices: [{ deviceId: OTHER, name: 'PC-B', home: null }],
      backups: [
        recovered(gameId, 'c.zip', { createdAt: at(3_000) }),
        recovered(gameId, 'a.zip', { createdAt: at(1_000) }),
        recovered(gameId, 'b.zip', { createdAt: at(2_000) }),
      ],
    });
    // La lista va por reloj de sync: la más nueva primero.
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.backupName),
      ['c.zip', 'b.zip', 'a.zip'],
    );
  });

  it('recuperar dos veces no duplica y no pisa la huella', () => {
    const gameId = celeste();
    const input = {
      devices: [{ deviceId: OTHER, name: 'PC-B', home: null }],
      backups: [recovered(gameId, 'a.zip', { contentHash: 'h1' })],
    };
    assert.equal(recoverSaveBackups(fx.ctx, input).recovered, 1);
    const second = recoverSaveBackups(fx.ctx, {
      ...input,
      backups: [recovered(gameId, 'a.zip', { contentHash: 'otra' })],
    });
    assert.equal(second.recovered, 0);
    assert.equal(second.alreadyIndexed, 1);
    assert.equal(count(fx.local, 'save_backups'), 1);
  });

  it('una copia propia recuperada no mueve lastSyncedHash', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h0');
    recoverSaveBackups(fx.ctx, {
      devices: [],
      backups: [
        recovered(gameId, 'propia.zip', {
          r2Key: saveObjectKey({
            saveKey: '26226',
            deviceId: fx.ctx.deviceId,
            backupName: 'propia.zip',
          }),
          contentHash: 'h9',
        }),
      ],
    });
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h0');
  });
});

describe('purgeSaveFolderRows (§12.7)', () => {
  /** Un juego con saveKey fijo y ya borrado, con copias de los dos PCs. */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- devuelve un objeto de prueba de forma obvia
  const deletedGame = (saveKey: string, title: string) => {
    const gameId = seedGame(fx.ctx, { title, saveKey });
    const keyOf = (deviceId: string, name: string): string =>
      saveObjectKey({ saveKey, deviceId, backupName: name });
    const own = seedSaveBackup(fx.ctx, {
      gameId,
      backupName: 'own.zip',
      r2Key: keyOf(fx.ctx.deviceId, 'own.zip'),
    });
    const other = asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      backupName: 'other.zip',
      r2Key: keyOf(OTHER, 'other.zip'),
    });
    return { gameId, own, other };
  };

  it('pone lápida a las copias de TODOS los PCs de esa carpeta (propias y ajenas)', () => {
    const { gameId, own, other } = deletedGame('77', 'Juego Borrado');
    fx.ctx.store.remove('games', gameId);

    assert.equal(purgeSaveFolderRows(fx.ctx, '77'), 2);
    assert.notEqual(rawRow(fx.local, 'save_backups', own)?.syncDeleted, null);
    assert.notEqual(rawRow(fx.local, 'save_backups', other)?.syncDeleted, null);
  });

  it('el prefijo "12" no se lleva "123"', () => {
    const short = deletedGame('12', 'Juego Doce');
    const long = deletedGame('123', 'Juego Ciento Veintitrés');
    fx.ctx.store.remove('games', short.gameId);
    fx.ctx.store.remove('games', long.gameId);

    assert.equal(purgeSaveFolderRows(fx.ctx, '12'), 2);
    assert.notEqual(rawRow(fx.local, 'save_backups', short.own)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'save_backups', long.own)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'save_backups', long.other)?.syncDeleted, null);
  });

  it('no toca las copias de otras carpetas de juegos vivos', () => {
    const dead = deletedGame('77', 'Juego Borrado');
    const alive = deletedGame('88', 'Juego Vivo');
    fx.ctx.store.remove('games', dead.gameId);

    purgeSaveFolderRows(fx.ctx, '77');
    assert.equal(rawRow(fx.local, 'save_backups', alive.own)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'save_backups', alive.other)?.syncDeleted, null);
  });

  it('un juego vivo con ese prefijo lo impide y no se borra nada', () => {
    const { own, other } = deletedGame('77', 'Juego Vivo');
    assert.throws(
      () => purgeSaveFolderRows(fx.ctx, '77'),
      (error) => isStoreError(error, 'invalid_value'),
    );
    assert.equal(rawRow(fx.local, 'save_backups', own)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'save_backups', other)?.syncDeleted, null);
  });

  it('un juego borrado y otro vivo con el mismo prefijo: manda el vivo y se rechaza', () => {
    const { gameId } = deletedGame('77', 'Juego Viejo');
    fx.ctx.store.remove('games', gameId);
    seedGame(fx.ctx, { title: 'Juego Nuevo', saveKey: '77' });
    assert.throws(
      () => purgeSaveFolderRows(fx.ctx, '77'),
      (error) => isStoreError(error, 'invalid_value'),
    );
  });

  it('sin copias devuelve 0 y repetirlo tampoco hace nada', () => {
    const { gameId } = deletedGame('77', 'Juego Borrado');
    fx.ctx.store.remove('games', gameId);
    assert.equal(purgeSaveFolderRows(fx.ctx, '999'), 0);
    assert.equal(purgeSaveFolderRows(fx.ctx, '77'), 2);
    assert.equal(purgeSaveFolderRows(fx.ctx, '77'), 0);
  });

  it('las filas ajenas SOLO se borran por la ruta: sin la regla registrada falla (not_owner)', () => {
    fx.close();
    fx = openSavesDb({ withRule: false });
    const { gameId, other } = deletedGame('77', 'Juego Borrado');
    fx.ctx.store.remove('games', gameId);
    assert.throws(
      () => purgeSaveFolderRows(fx.ctx, '77'),
      (error) => isStoreError(error, 'not_owner'),
    );
    // Y la transacción se deshizo entera: tampoco la propia.
    assert.equal(rawRow(fx.local, 'save_backups', other)?.syncDeleted, null);
    assert.equal(
      fx.ctx.db.$client
        .prepare('SELECT count(*) AS n FROM "save_backups" WHERE syncDeleted IS NOT NULL')
        .get()?.n,
      0,
    );
  });

  it('al terminar la ruta se cierra: borrar una copia ajena fuera de ella sigue prohibido', () => {
    const { gameId, other } = deletedGame('77', 'Juego Borrado');
    const survivor = asOtherDevice(fx.ctx, { deviceId: 'otro-dispositivo-c', name: 'PC-C' });
    const stray = survivor.seedSaveBackup({
      gameId,
      backupName: 'stray.zip',
      r2Key: saveObjectKey({
        saveKey: '77',
        deviceId: 'otro-dispositivo-c',
        backupName: 'stray.zip',
      }),
    });
    fx.ctx.store.remove('games', gameId);
    purgeSaveFolderRows(fx.ctx, '77');
    assert.notEqual(rawRow(fx.local, 'save_backups', other)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'save_backups', stray)?.syncDeleted !== null, true);
    // Una copia ajena NUEVA de otro juego, fuera de la ruta: sigue sin poder borrarse.
    const another = seedGame(fx.ctx, { title: 'Otro', saveKey: '55' });
    const foreign = asOtherDevice(fx.ctx, {
      deviceId: 'otro-dispositivo-d',
      name: 'PC-D',
    }).seedSaveBackup({
      gameId: another,
      r2Key: saveObjectKey({ saveKey: '55', deviceId: 'otro-dispositivo-d', backupName: 'f.zip' }),
      backupName: 'f.zip',
    });
    assert.throws(
      () => fx.ctx.store.remove('save_backups', foreign),
      (error) => isStoreError(error, 'not_owner'),
    );
  });
});

describe('saveKeyFolder y listSaveKeyGames', () => {
  it('saveKeyFolder es saves/<saveKey>/ y valida el trozo', () => {
    assert.equal(saveKeyFolder('12'), 'saves/12/');
    assert.throws(
      () => saveKeyFolder('a/b'),
      (error) => isStoreError(error, 'invalid_value'),
    );
    assert.throws(
      () => saveKeyFolder(''),
      (error) => isStoreError(error, 'invalid_value'),
    );
  });

  it('listSaveKeyGames incluye borrados y un vivo manda sobre un borrado', () => {
    const gone = seedGame(fx.ctx, { title: 'Borrado', saveKey: '10' });
    fx.ctx.store.remove('games', gone);
    const live = seedGame(fx.ctx, { title: 'Vivo', saveKey: '20' });
    const oldShared = seedGame(fx.ctx, { title: 'Viejo compartido', saveKey: '30' });
    fx.ctx.store.remove('games', oldShared);
    const newShared = seedGame(fx.ctx, { title: 'Nuevo compartido', saveKey: '30' });

    const map = listSaveKeyGames(fx.ctx);
    assert.deepEqual(map.get('10'), { gameId: gone, title: 'Borrado', alive: false });
    assert.deepEqual(map.get('20'), { gameId: live, title: 'Vivo', alive: true });
    assert.deepEqual(map.get('30'), { gameId: newShared, title: 'Nuevo compartido', alive: true });
    assert.equal(map.has('99'), false);
  });
});

describe('listSaveLineage', () => {
  it('devuelve las filas vivas y las que tienen lápida, de todos los PCs', () => {
    const gameId = celeste();
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    const other = asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      contentHash: 'h3',
      parentContentHash: 'h2',
    });
    fx.ctx.store.remove('save_backups', ownId('v1.zip'));

    const rows = listSaveLineage(fx.ctx, gameId);
    assert.equal(rows.length, 3);
    const byHash = new Map(rows.map((row) => [row.contentHash, row]));
    assert.equal(byHash.get('h1')?.alive, false);
    assert.equal(byHash.get('h2')?.alive, true);
    assert.equal(byHash.get('h2')?.parentContentHash, 'h1');
    assert.equal(byHash.get('h2')?.deviceName, 'PC-A');
    assert.equal(byHash.get('h3')?.deviceId, OTHER);
    assert.equal(byHash.get('h3')?.deviceName, 'PC-B');
    assert.equal(byHash.get('h3')?.parentContentHash, 'h2');
    assert.equal(rows.find((row) => row.id === other)?.alive, true);
    // `order` es el reloj de sync de la creación.
    assert.ok(rows.every((row) => typeof row.order === 'string' && row.order.length > 0));
  });

  it('el reloj de sync (order) crece con el orden real de creación', () => {
    const gameId = celeste();
    reconcile(gameId, [
      version('v1.zip', { createdAt: at(1_000), contentHash: 'h1' }),
      version('v2.zip', { createdAt: at(2_000), contentHash: 'h2' }),
    ]);
    const rows = listSaveLineage(fx.ctx, gameId);
    const first = rows.find((row) => row.contentHash === 'h1');
    const second = rows.find((row) => row.contentHash === 'h2');
    assert.ok(first && second && first.order < second.order);
  });

  it('un juego borrado o que no existe no devuelve nada', () => {
    const gameId = celeste();
    reconcile(gameId, [version('v1.zip', { contentHash: 'h1' })]);
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(listSaveLineage(fx.ctx, gameId), []);
    assert.deepEqual(listSaveLineage(fx.ctx, 'no-existe'), []);
  });

  it('solo las copias del juego pedido', () => {
    const gameId = celeste();
    const otherGame = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    seedSaveBackup(fx.ctx, { gameId, contentHash: 'h1' });
    seedSaveBackup(fx.ctx, { gameId: otherGame, contentHash: 'h2' });
    assert.deepEqual(
      listSaveLineage(fx.ctx, gameId).map((row) => row.contentHash),
      ['h1'],
    );
  });

  it('la fila de un dispositivo desconocido sale con el nombre por defecto', () => {
    const gameId = celeste();
    seedSaveBackup(fx.ctx, { gameId, contentHash: 'h1' });
    // Sin la fila de devices (una fila llegada por sync puede adelantarse a la de su
    // dispositivo): se simula quitando la clave foránea de en medio.
    fx.ctx.db.$client.exec('PRAGMA foreign_keys = OFF');
    fx.ctx.db.$client.prepare('DELETE FROM "devices" WHERE id = ?').run(fx.ctx.deviceId);
    assert.equal(listSaveLineage(fx.ctx, gameId)[0].deviceName, UNKNOWN_DEVICE_NAME);
  });
});

describe('listSaveBackups: orden por reloj de sync (§12.5)', () => {
  it('manda el reloj de sync y no la hora de pared de cada copia', () => {
    const gameId = celeste();
    // Creada primero pero con la hora de pared MÁS tardía (un PC con el reloj adelantado).
    seedSaveBackup(fx.ctx, { gameId, backupName: 'primera.zip', createdAt: day(30) });
    fx.wall.advance(1_000);
    seedSaveBackup(fx.ctx, { gameId, backupName: 'segunda.zip', createdAt: day(1) });
    assert.deepEqual(
      listSaveBackups(fx.ctx, gameId).map((row) => row.backupName),
      ['segunda.zip', 'primera.zip'],
    );
  });
});

describe('listOwnDeletedBackupNames', () => {
  it('solo las propias con lápida, de ese juego', () => {
    const gameId = celeste();
    const otherGame = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    const keep = seedSaveBackup(fx.ctx, { gameId, backupName: 'viva.zip' });
    const gone = seedSaveBackup(fx.ctx, { gameId, backupName: 'borrada.zip' });
    const goneOther = seedSaveBackup(fx.ctx, {
      gameId: otherGame,
      backupName: 'de-otro-juego.zip',
    });
    const theirs = asOtherDevice(fx.ctx).seedSaveBackup({ gameId, backupName: 'ajena.zip' });
    fx.ctx.store.remove('save_backups', gone);
    fx.ctx.store.remove('save_backups', goneOther);
    // La lápida de la ajena llega "por sync".
    fx.ctx.db.$client
      .prepare('UPDATE "save_backups" SET syncDeleted = ? WHERE id = ?')
      .run('0000000000001-0000-pcbbbb', theirs);

    assert.deepEqual(listOwnDeletedBackupNames(fx.ctx, gameId), ['borrada.zip']);
    assert.notEqual(keep, undefined);
    assert.deepEqual(listOwnDeletedBackupNames(fx.ctx, 'no-existe'), []);
  });
});

describe('lastSyncedHash (local_save_state)', () => {
  it('se guarda y se lee por juego; sin fila es null', () => {
    const gameId = celeste();
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
    setLastSyncedHash(fx.ctx, gameId, 'h1');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h1');
    setLastSyncedHash(fx.ctx, gameId, 'h2');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h2');
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 1);
  });

  it('guardar la huella no toca el destino de restauración y al revés', () => {
    const gameId = celeste();
    setSaveRestoreTarget(fx.ctx, gameId, 'D:/Juegos/Celeste');
    setLastSyncedHash(fx.ctx, gameId, 'h1');
    assert.equal(getSaveRestoreTarget(fx.ctx, gameId)?.target, 'D:/Juegos/Celeste');
    setSaveRestoreTarget(fx.ctx, gameId, 'E:/otro');
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'h1');
  });

  it('null sin destino borra la fila entera', () => {
    const gameId = celeste();
    setLastSyncedHash(fx.ctx, gameId, 'h1');
    setLastSyncedHash(fx.ctx, gameId, null);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 0);
  });

  it('null CON destino conserva la fila (el destino sigue siendo válido)', () => {
    const gameId = celeste();
    setSaveRestoreTarget(fx.ctx, gameId, 'D:/Juegos/Celeste');
    setLastSyncedHash(fx.ctx, gameId, 'h1');
    setLastSyncedHash(fx.ctx, gameId, null);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
    assert.equal(getSaveRestoreTarget(fx.ctx, gameId)?.target, 'D:/Juegos/Celeste');
  });

  it('null en un juego sin fila no hace nada ni lanza', () => {
    setLastSyncedHash(fx.ctx, 'sin-fila', null);
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 0);
  });

  it('clearAllLastSyncedHashes: borra las filas que solo guardaban huella y conserva los destinos', () => {
    const onlyHash = celeste();
    const withTarget = seedGame(fx.ctx, { title: 'Hades', igdbId: 113112 });
    const onlyTarget = seedGame(fx.ctx, { title: 'Tunic', igdbId: 1 });
    setLastSyncedHash(fx.ctx, onlyHash, 'h1');
    setSaveRestoreTarget(fx.ctx, withTarget, 'D:/Hades');
    setLastSyncedHash(fx.ctx, withTarget, 'h2');
    setSaveRestoreTarget(fx.ctx, onlyTarget, 'D:/Tunic');

    clearAllLastSyncedHashes(fx.ctx);

    assert.equal(getLastSyncedHash(fx.ctx, onlyHash), null);
    assert.equal(getLastSyncedHash(fx.ctx, withTarget), null);
    assert.equal(getSaveRestoreTarget(fx.ctx, withTarget)?.target, 'D:/Hades');
    assert.equal(getSaveRestoreTarget(fx.ctx, onlyTarget)?.target, 'D:/Tunic');
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 2);
  });
});

describe('valor de instalación publicado en devices (§12.6)', () => {
  it('se publica si no había, y después es el mismo', () => {
    assert.equal(readPublishedInstallNonce(fx.ctx), null);
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-a'), 'published');
    assert.equal(readPublishedInstallNonce(fx.ctx), 'nonce-a');
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-a'), 'same');
  });

  it('uno distinto es un conflicto y NO se pisa', () => {
    checkInstallNonce(fx.ctx, 'nonce-a');
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-copia'), 'conflict');
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-copia'), 'conflict');
    assert.equal(readPublishedInstallNonce(fx.ctx), 'nonce-a');
  });

  it('forcePublishInstallNonce lo pisa a propósito ("este PC es el original")', () => {
    checkInstallNonce(fx.ctx, 'nonce-a');
    forcePublishInstallNonce(fx.ctx, 'nonce-b');
    assert.equal(readPublishedInstallNonce(fx.ctx), 'nonce-b');
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-b'), 'same');
    assert.equal(checkInstallNonce(fx.ctx, 'nonce-a'), 'conflict');
  });

  it('el valor de otro dispositivo no cuenta como el de este', () => {
    asOtherDevice(fx.ctx, { deviceId: OTHER });
    forcePublishInstallNonce(fx.ctx, 'nonce-a');
    const other = fx.ctx.db.$client
      .prepare('SELECT installNonce FROM "devices" WHERE id = ?')
      .get(OTHER) as { installNonce: string | null };
    assert.equal(other.installNonce, null);
  });

  it('sin la fila del dispositivo: no-device, sin lanzar', () => {
    const bare = openQueryDb({ withThisDevice: false });
    try {
      assert.equal(checkInstallNonce(bare.ctx, 'nonce-a'), 'no-device');
      assert.equal(readPublishedInstallNonce(bare.ctx), null);
    } finally {
      bare.close();
    }
  });
});
