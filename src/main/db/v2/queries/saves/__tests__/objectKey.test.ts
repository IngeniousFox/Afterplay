import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveBackupId } from '../../../../../../shared/sync/ids';
import {
  parseSaveObjectKey,
  saveBackupIdForKey,
  saveFolderPrefix,
  saveObjectKey,
} from '../objectKey';

// La clave de la que sale el id de una copia (F-21). Datos inventados.

const DEVICE = '0194c2f0-aaaa-7000-8000-00000000000a';

describe('clave de objeto de una copia', () => {
  it('es la misma que escribe la 1.x: saves/<igdbId>/<machineId>/<zip>', () => {
    assert.equal(saveFolderPrefix('1942', DEVICE), `saves/1942/${DEVICE}/`);
    assert.equal(
      saveObjectKey({
        saveKey: '1942',
        deviceId: DEVICE,
        backupName: 'backup-20260101T000000Z.zip',
      }),
      `saves/1942/${DEVICE}/backup-20260101T000000Z.zip`,
    );
  });

  it('un juego sin igdbId usa su id como prefijo', () => {
    const gameId = '0194c2f0-cccc-7000-8000-00000000000c';
    const key = saveObjectKey({ saveKey: gameId, deviceId: DEVICE, backupName: 'b.zip' });
    assert.deepEqual(parseSaveObjectKey(key), {
      saveKey: gameId,
      deviceId: DEVICE,
      backupName: 'b.zip',
    });
  });

  it('parsear y volver a construir da la misma clave, y el mismo id', () => {
    const key = `saves/26226/${DEVICE}/backup-1.zip`;
    const parts = parseSaveObjectKey(key);
    assert.ok(parts);
    assert.equal(saveObjectKey(parts), key);
    assert.equal(saveBackupIdForKey(key), saveBackupId(key));
  });

  it('cualquier otra forma se ignora', () => {
    for (const key of [
      'machines/x.json',
      'saves/1/x.zip',
      'saves/1/m/sub/x.zip',
      '/saves/1/m/x.zip',
      'saves//m/x.zip',
      'saves/1/m/',
      'saves/1/../x.zip',
    ]) {
      assert.equal(parseSaveObjectKey(key), null, key);
    }
  });

  it('rechaza partes vacías o con barra', () => {
    assert.throws(() => saveFolderPrefix('', DEVICE), RangeError);
    assert.throws(() => saveFolderPrefix('1/2', DEVICE), RangeError);
    assert.throws(
      () => saveObjectKey({ saveKey: '1', deviceId: DEVICE, backupName: '..' }),
      RangeError,
    );
  });
});
