import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { extraSaveFiles, removeSaveFiles } from '../exactRestore';

// Restauración exacta (§12.7, F-22): qué archivos sobran y que borrarlos nunca
// toque carpetas. Datos inventados, en una carpeta temporal.

describe('extraSaveFiles', () => {
  it('devuelve los archivos que la restauración no ha escrito', () => {
    const extras = extraSaveFiles(
      [
        'C:/Users/ana/Saves/slot1.sav',
        'C:/Users/ana/Saves/slot2.sav',
        'C:/Users/ana/Saves/auto.sav',
      ],
      ['C:/Users/ana/Saves/slot1.sav'],
    );
    assert.deepEqual(extras, ['C:/Users/ana/Saves/auto.sav', 'C:/Users/ana/Saves/slot2.sav']);
  });

  it('compara sin distinguir mayúsculas ni el tipo de barra', () => {
    const extras = extraSaveFiles(
      ['C:\\Users\\ana\\Saves\\Slot1.sav', 'C:\\Users\\ana\\Saves\\Otro.sav'],
      ['c:/users/ana/saves/SLOT1.SAV'],
    );
    assert.deepEqual(extras, ['C:/Users/ana/Saves/Otro.sav']);
  });

  it('quita duplicados y ordena', () => {
    const extras = extraSaveFiles(['D:/b.sav', 'D:/a.sav', 'D:\\B.SAV', 'd:/a.sav'], []);
    assert.deepEqual(extras, ['D:/a.sav', 'D:/b.sav']);
  });

  it('si la restauración escribió todo, no sobra nada', () => {
    assert.deepEqual(extraSaveFiles(['D:/a.sav'], ['D:/a.sav', 'D:/otro.sav']), []);
    assert.deepEqual(extraSaveFiles([], ['D:/a.sav']), []);
  });
});

describe('removeSaveFiles', () => {
  let root: string;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'afterplay-saves-exact-'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('borra solo archivos normales y cuenta como borrado el que ya no está', () => {
    const dir = join(root, 'files');
    mkdirSync(dir);
    const a = join(dir, 'a.sav');
    const b = join(dir, 'b.sav');
    const keep = join(dir, 'keep.sav');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    writeFileSync(keep, 'keep');
    const missing = join(dir, 'ya-no-esta.sav');

    const result = removeSaveFiles([a, b, missing]);

    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.removed.sort(), [a, b, missing].sort());
    assert.equal(existsSync(a), false);
    assert.equal(existsSync(b), false);
    assert.equal(readFileSync(keep, 'utf-8'), 'keep');
  });

  it('una carpeta NUNCA se borra: va a failed y queda intacta con su contenido', () => {
    const dir = join(root, 'folder');
    const inner = join(dir, 'dentro.sav');
    mkdirSync(dir);
    writeFileSync(inner, 'dentro');

    const result = removeSaveFiles([dir]);

    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.failed, [dir]);
    assert.equal(existsSync(dir), true);
    assert.equal(readFileSync(inner, 'utf-8'), 'dentro');
  });

  it('un fallo no impide borrar el resto', () => {
    const dir = join(root, 'mixed');
    mkdirSync(dir);
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const file = join(dir, 'x.sav');
    writeFileSync(file, 'x');

    const result = removeSaveFiles([sub, file]);

    assert.deepEqual(result.failed, [sub]);
    assert.deepEqual(result.removed, [file]);
    assert.equal(existsSync(sub), true);
    assert.equal(existsSync(file), false);
  });

  it('un enlace simbólico no se sigue ni se borra (si el sistema deja crearlo)', (t) => {
    const dir = join(root, 'links');
    mkdirSync(dir);
    const target = join(dir, 'objetivo.sav');
    const link = join(dir, 'enlace.sav');
    writeFileSync(target, 'objetivo');
    try {
      symlinkSync(target, link);
    } catch {
      // Windows sin privilegio de enlaces: nada que comprobar aquí.
      t.skip('no se pueden crear enlaces simbólicos');
      return;
    }

    const result = removeSaveFiles([link]);

    assert.deepEqual(result.failed, [link]);
    assert.equal(readFileSync(target, 'utf-8'), 'objetivo');
  });

  it('sin rutas no hace nada', () => {
    assert.deepEqual(removeSaveFiles([]), { removed: [], failed: [] });
  });
});
