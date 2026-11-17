import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { tempDir } from '../../db/v2/__tests__/helpers';
import {
  CUTOVER_PROGRESS_FILE,
  createFileProgressStore,
  cutoverNeeded,
  type CutoverTrigger,
} from '../cutoverProgress';

// La marca de progreso en disco y el disparador del corte. Carpetas temporales.

const dirs: { cleanup(): void }[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

const userData = (files: string[] = []): string => {
  const dir = tempDir();
  dirs.push(dir);
  const path = join(dir.path, 'Afterplay');
  mkdirSync(path);
  for (const file of files) writeFileSync(join(path, file), '');
  return path;
};

const trigger = (dir: string, over: Partial<CutoverTrigger> = {}): CutoverTrigger => ({
  userDataDir: dir,
  isE2E: false,
  isDevProfile: false,
  force: false,
  ...over,
});

describe('cutover: marca de progreso', () => {
  it('escribe, lee y borra', () => {
    const dir = userData();
    const store = createFileProgressStore(dir);
    assert.equal(store.read(), null);
    store.write({ version: 1, role: 'migrator', startedAt: 5, imported: true });
    assert.deepEqual(createFileProgressStore(dir).read(), {
      version: 1,
      role: 'migrator',
      startedAt: 5,
      imported: true,
    });
    store.clear();
    assert.equal(store.read(), null);
  });

  it('un fichero ilegible o con otra forma cuenta como "no hay marca"', () => {
    const dir = userData();
    const store = createFileProgressStore(dir);
    writeFileSync(join(dir, CUTOVER_PROGRESS_FILE), '{ no es json');
    assert.equal(store.read(), null);
    writeFileSync(join(dir, CUTOVER_PROGRESS_FILE), JSON.stringify({ version: 2, role: 'x' }));
    assert.equal(store.read(), null);
  });
});

describe('cutover: cuándo hace falta', () => {
  it('1.x sin base 2.0: sí', () => {
    assert.equal(cutoverNeeded(trigger(userData(['Afterplay.db']))), true);
  });

  it('sin 1.x: no (instalación nueva)', () => {
    assert.equal(cutoverNeeded(trigger(userData())), false);
    assert.equal(cutoverNeeded(trigger(userData(['Afterplay2.db']))), false);
  });

  it('1.x y 2.0 ya migrada, sin marca: no', () => {
    assert.equal(cutoverNeeded(trigger(userData(['Afterplay.db', 'Afterplay2.db']))), false);
  });

  it('1.x y 2.0 con una marca sin terminar: sí; terminada: no', () => {
    const dir = userData(['Afterplay.db', 'Afterplay2.db']);
    const store = createFileProgressStore(dir);
    store.write({ version: 1, role: 'migrator', startedAt: 1, imported: true });
    assert.equal(cutoverNeeded(trigger(dir)), true);
    store.write({ version: 1, role: 'migrator', startedAt: 1, completed: true });
    assert.equal(cutoverNeeded(trigger(dir)), false);
  });

  it('el perfil de desarrollo sigue importando solo, salvo que se fuerce; un e2e nunca corta', () => {
    const dir = userData(['Afterplay.db']);
    assert.equal(cutoverNeeded(trigger(dir, { isDevProfile: true })), false);
    assert.equal(cutoverNeeded(trigger(dir, { isDevProfile: true, force: true })), true);
    assert.equal(cutoverNeeded(trigger(dir, { isE2E: true, force: true })), false);
  });
});
