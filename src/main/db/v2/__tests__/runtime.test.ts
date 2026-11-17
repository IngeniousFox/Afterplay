import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { LegacyDb, DAY } from '../importer/__tests__/fixture';
import { gameIdForIgdb } from '../../../../shared/sync/ids';
import {
  getLastSyncedHash,
  getSaveRestoreTarget,
  isSaveReindexPending,
  recordSaveReindexRun,
  remapLegacyRestoreTargets,
} from '../queries/saves';
import {
  AppDatabaseError,
  importLegacyIntoLocal,
  openAppDatabase,
  removeLocalDatabase,
  type OpenedAppDatabase,
} from '../runtime';
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
      // El primero lleva igdbId: su id 2.0 sale del igdbId, no del id antiguo.
      legacy.game({
        title: `Juego ${index}`,
        addedAt: NOW - (index + 1) * DAY,
        ...(index === 0 ? { igdbId: 4242 } : {}),
      });
    }
    legacy.client.exec(`VACUUM INTO '${join(path, 'Afterplay.db').replace(/'/g, "''")}'`);
    legacy.close();
  }
  return path;
};

const open = (dir: string, allowImport = true, freshDatabase = false): OpenedAppDatabase => {
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
    freshDatabase,
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

  it('tras importar deja pendiente el reindexado de partidas; sin importar, no', () => {
    const dir = userData(2);
    const first = open(dir);
    assert.equal(isSaveReindexPending(first.ctx), true);
    // Cumplido: un arranque posterior no lo vuelve a marcar.
    recordSaveReindexRun(first.ctx, { ok: true });
    first.local.close();
    opened.splice(0);
    const again = open(dir);
    assert.equal(again.imported, null);
    assert.equal(isSaveReindexPending(again.ctx), false);

    const empty = open(userData());
    assert.equal(empty.imported, null);
    assert.equal(isSaveReindexPending(empty.ctx), false);
  });

  it('el marcador sigue pendiente en un arranque posterior si no se cumplió', () => {
    const dir = userData(1);
    open(dir).local.close();
    opened.splice(0);
    const again = open(dir);
    assert.equal(again.imported, null);
    assert.equal(isSaveReindexPending(again.ctx), true);
  });

  it('los destinos de machine-saves.json llegan al id 2.0, también con igdbId', () => {
    const app = open(userData(2));
    // El juego 1.x nº 1 tiene igdbId: su id es el del igdbId, NO legacyUuid.
    const withIgdb = gameIdForIgdb(4242);
    const manual = app.ctx.db.$client
      .prepare(`SELECT newId FROM local_legacy_ids WHERE legacyTable = 'games' AND legacyId = 2`)
      .get() as { newId: string };
    const moved = remapLegacyRestoreTargets(app.ctx, [
      ['1', 'D:\\Saves\\Uno'],
      ['2', 'E:/Dos'],
    ]);
    assert.equal(moved, 2);
    assert.equal(getSaveRestoreTarget(app.ctx, withIgdb)?.target, 'D:/Saves/Uno');
    assert.equal(getSaveRestoreTarget(app.ctx, manual.newId)?.target, 'E:/Dos');
    assert.equal(getLastSyncedHash(app.ctx, withIgdb), null);
  });

  it('si la importación falla no deja base 2.0', () => {
    const dir = userData();
    writeFileSync(join(dir, 'Afterplay.db'), 'esto no es una base');
    assert.throws(() => open(dir), AppDatabaseError);
    assert.equal(existsSync(join(dir, 'Afterplay2.db')), false);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
  });
  it('freshDatabase crea una base vacía junto a la 1.x sin importarla (PC secundario del corte)', () => {
    const dir = userData(3);
    const app = open(dir, false, true);
    assert.equal(app.imported, null);
    assert.equal(count(app.local, 'games'), 0);
    assert.equal(count(app.local, 'devices', `id = '${DEVICE}'`), 1);
    assert.equal(isSaveReindexPending(app.ctx), false);
    assert.ok(existsSync(join(dir, 'Afterplay.db')), 'la 1.x sigue en su sitio');
    assert.equal(existsSync(join(dir, 'backups')), false, 'no copia ni importa nada');
  });
});

describe('runtime: la importación del corte (importLegacyIntoLocal)', () => {
  const importNow = (dir: string): ReturnType<typeof importLegacyIntoLocal> =>
    importLegacyIntoLocal({
      userDataDir: dir,
      deviceId: DEVICE,
      migrationsFolder: MIGRATIONS_FOLDER,
      now: new Date(NOW),
      log: () => {},
    });

  const vacuumTo = (legacy: LegacyDb, dir: string): void => {
    legacy.client.exec(`VACUUM INTO '${join(dir, 'Afterplay.db').replace(/'/g, "''")}'`);
    legacy.close();
  };

  it('importa antes de abrir y la base resultante se abre sin volver a importar', () => {
    const dir = userData(3);
    const report = importNow(dir);
    assert.ok(report.validation.ok);
    assert.ok(existsSync(join(dir, 'Afterplay2.db')));
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
    assert.equal(readdirSync(join(dir, 'backups')).filter((n) => n.endsWith('.db')).length, 1);
    const app = open(dir, false);
    assert.equal(app.imported, null);
    assert.equal(count(app.local, 'games'), 3);
  });

  it('cierra las sesiones abiertas en su último latido (también en producción)', () => {
    const dir = userData();
    const legacy = new LegacyDb();
    const game = legacy.game({ title: 'Abierto', addedAt: NOW - 10 * DAY });
    const iteration = legacy.iteration(game);
    legacy.insert('sessions', {
      iterationId: iteration,
      startedAt: NOW - 3 * DAY,
      lastHeartbeatAt: NOW - 3 * DAY + 90 * 60_000,
      startedBy: 'watcher',
      datePrecision: 'datetime',
    });
    vacuumTo(legacy, dir);

    importNow(dir);
    const app = open(dir, false);
    const row = app.local.db.$client.prepare('SELECT durationSec FROM sessions').get() as {
      durationSec: number;
    };
    assert.equal(row.durationSec, 90 * 60);
  });

  it('un buzón con órdenes pendientes lo bloquea y no deja base ni marcador', () => {
    const dir = userData();
    const legacy = new LegacyDb();
    legacy.game({ title: 'Uno', addedAt: NOW - DAY });
    legacy.insert('plan_mailbox', { type: 'pin', payload: '{}', createdAt: NOW - DAY });
    vacuumTo(legacy, dir);
    assert.throws(
      () => importNow(dir),
      (error: unknown) =>
        error instanceof AppDatabaseError &&
        (error.cause as Error | undefined)?.name === 'ImportBlockedError',
    );
    assert.equal(existsSync(join(dir, 'Afterplay2.db')), false);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
  });

  it('removeLocalDatabase borra la base y su marcador y no toca la 1.x', () => {
    const dir = userData(1);
    importNow(dir);
    writeFileSync(join(dir, 'Afterplay2.db.importing'), 'x');
    removeLocalDatabase(dir);
    assert.equal(existsSync(join(dir, 'Afterplay2.db')), false);
    assert.equal(existsSync(join(dir, 'Afterplay2.db.importing')), false);
    assert.ok(existsSync(join(dir, 'Afterplay.db')), 'la 1.x intacta');
  });
});
