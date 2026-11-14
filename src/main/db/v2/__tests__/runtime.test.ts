import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { LegacyDb, DAY } from '../importer/__tests__/fixture';
import { AppDatabaseError, openAppDatabase, type OpenedAppDatabase } from '../runtime';
import { MIGRATIONS_FOLDER, count, tempDir } from './helpers';

const NOW = Date.UTC(2026, 10, 14);
const DEVICE = 'device-runtime-test';

const opened: OpenedAppDatabase[] = [];
const dirs: { cleanup(): void }[] = [];
afterEach(() => {
  for (const item of opened.splice(0)) item.local.close();
  for (const dir of dirs.splice(0)) dir.cleanup();
});

/** Una carpeta de datos de la app (tiene que llamarse como una, por la protección). */
const userData = (withLegacyGames = 0): string => {
  const dir = tempDir();
  dirs.push(dir);
  const path = join(dir.path, 'Afterplay-dev-runtime');
  mkdirSync(path);
  if (withLegacyGames > 0) {
    const legacy = new LegacyDb();
    for (let index = 0; index < withLegacyGames; index++) {
      legacy.game({ title: `Juego ${index}`, addedAt: NOW - (index + 1) * DAY });
    }
    legacy.client.exec(`VACUUM INTO '${join(path, 'Afterplay.db').replace(/'/g, "''")}'`);
    legacy.close();
  }
  return path;
};

const open = (dir: string, allowImport = true): OpenedAppDatabase => {
  const result = openAppDatabase({
    userDataDir: dir,
    deviceId: DEVICE,
    migrationsFolder: MIGRATIONS_FOLDER,
    device: {
      name: 'PC de prueba',
      home: 'C:\\Users\\prueba',
      appVersion: '2.0.0',
      schemaVersion: 1,
    },
    allowImport,
    now: () => new Date(NOW),
    log: () => {},
  });
  opened.push(result);
  return result;
};

describe('runtime: abrir la base 2.0 de la app', () => {
  it('sin 1.x al lado crea una base vacía con este dispositivo', () => {
    const dir = userData();
    const app = open(dir);
    assert.equal(app.imported, null);
    assert.equal(count(app.local, 'games'), 0);
    assert.equal(count(app.local, 'devices', `id = '${DEVICE}'`), 1);
  });

  it('la primera vez importa la 1.x y deja una copia en backups/', () => {
    const dir = userData(3);
    const app = open(dir);
    assert.ok(app.imported);
    assert.equal(count(app.local, 'games'), 3);
    const copies = readdirSync(join(dir, 'backups')).filter((name) => name.endsWith('.db'));
    assert.equal(copies.length, 1);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
    assert.ok(existsSync(join(dir, 'Afterplay.db')), 'la 1.x sigue en su sitio');
  });

  it('la segunda vez abre la base que ya existe sin importar', () => {
    const dir = userData(2);
    open(dir).local.close();
    opened.splice(0);
    const again = open(dir);
    assert.equal(again.imported, null);
    assert.equal(count(again.local, 'games'), 2);
  });

  it('sin permiso para importar no toca nada', () => {
    const dir = userData(1);
    assert.throws(() => open(dir, false), AppDatabaseError);
    assert.equal(existsSync(join(dir, 'Afterplay2.db')), false);
  });

  it('una importación a medias se repite entera', () => {
    const dir = userData(2);
    open(dir).local.close();
    opened.splice(0);
    // Como si la app hubiera muerto antes de borrar el marcador.
    writeFileSync(join(dir, 'Afterplay2.db.importing'), 'x');
    const again = open(dir);
    assert.ok(again.imported, 'ha vuelto a importar');
    assert.equal(count(again.local, 'games'), 2);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
  });

  it('si la importación falla no deja base 2.0', () => {
    const dir = userData();
    writeFileSync(join(dir, 'Afterplay.db'), 'esto no es una base');
    assert.throws(() => open(dir), AppDatabaseError);
    assert.equal(existsSync(join(dir, 'Afterplay2.db')), false);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
  });
});
