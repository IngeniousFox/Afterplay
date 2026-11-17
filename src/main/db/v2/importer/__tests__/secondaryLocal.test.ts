import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { LocalDatabase } from '../../connection';
import { gameIdForIgdb } from '../../../../../shared/sync/ids';
import { importLegacyDatabase, legacyUuid } from '..';
import { migrateSecondaryLocal } from '../secondaryLocal';
import { DAY, LegacyDb, openTarget, T } from './fixture';

// El PC secundario del corte (§19.6): no importa, pero reconstruye en local lo
// que el importador deja en el migrador. La prueba central es la IGUALDAD con
// una importación de verdad de la misma 1.x.

const open: { close(): void }[] = [];
const track = <V extends { close(): void }>(value: V): V => {
  open.push(value);
  return value;
};
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

type Raw = Record<string, unknown>;
const all = (target: LocalDatabase, sql: string): Raw[] =>
  target.db.$client
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));

const INSTALLED = new Set(['C:\\Juegos\\a.exe', 'C:\\Juegos\\a', 'D:\\Emu\\emu.exe']);
const exists = (path: string): boolean => INSTALLED.has(path);

/** Una 1.x con juegos con y sin igdbId, rutas de aquí y de otro PC, y un emulador. */
function source(): LegacyDb {
  const db = track(new LegacyDb());
  const withIgdb = db.game({
    title: 'Con IGDB',
    igdbId: 100,
    addedAt: T,
    executablePath: 'C:\\Juegos\\a.exe',
    installDirectory: 'C:\\Juegos\\a',
    installSizeBytes: 123,
  });
  db.iteration(withIgdb);
  db.game({ title: 'Sin IGDB', addedAt: T + DAY, executablePath: 'E:\\Otro PC\\b.exe' });
  db.game({ title: 'Sin rutas', igdbId: 300, addedAt: T + 2 * DAY });
  db.game({ title: 'Otro sin IGDB', addedAt: T + 3 * DAY });
  db.insert('emulators', { name: 'Emu', executablePath: 'D:\\Emu\\emu.exe' });
  db.insert('emulators', { name: 'Emu de otro PC', executablePath: 'E:\\Emu\\x.exe' });
  return db;
}

/** Lo que baja del hub a un PC secundario: juegos y emuladores ya existentes. */
function pullFrom(migrated: LocalDatabase, secondary: LocalDatabase): void {
  for (const table of ['games', 'emulators']) {
    for (const row of all(migrated, `SELECT * FROM "${table}"`)) {
      const columns = Object.keys(row);
      secondary.db.$client
        .prepare(
          `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        )
        .run(...(columns.map((c) => row[c]) as never[]));
    }
  }
}

const legacyIds = (target: LocalDatabase): Raw[] =>
  all(
    target,
    `SELECT * FROM local_legacy_ids WHERE legacyTable IN ('games', 'emulators') ORDER BY legacyTable, legacyId`,
  );
// Sin las columnas de sync: el reloj lleva el id corto aleatorio de cada base.
const withoutSync = (row: Raw): Raw =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('sync')));
const installs = (target: LocalDatabase): Raw[] =>
  [
    ...all(target, 'SELECT * FROM game_installs ORDER BY id'),
    ...all(target, 'SELECT * FROM emulator_installs ORDER BY id'),
  ].map(withoutSync);

describe('migración local del PC secundario (§19.6)', () => {
  it('reconstruye el mapa de ids y las instalaciones IGUAL que una importación real', () => {
    const db = source();
    const migrated = track(openTarget());
    importLegacyDatabase({
      source: db.client,
      target: migrated,
      claimInstalls: true,
      pathExists: exists,
      now: T,
    });
    const secondary = track(openTarget());
    pullFrom(migrated, secondary);

    const report = migrateSecondaryLocal({
      source: db.client,
      target: secondary,
      now: T,
      pathExists: exists,
    });

    const expectedIds = legacyIds(migrated);
    assert.equal(expectedIds.length, 6, '4 juegos + 2 emuladores');
    assert.deepEqual(legacyIds(secondary), expectedIds);
    assert.equal(report.legacyIdsWritten, 6);
    assert.equal(report.gamesNotInHub, 0);

    const expectedInstalls = installs(migrated);
    assert.equal(expectedInstalls.length, 2, 'solo las rutas que existen en este disco');
    assert.deepEqual(installs(secondary), expectedInstalls);
    assert.deepEqual([report.installs.games, report.installs.emulators], [1, 1]);
  });

  it('los juegos con igdbId toman el id natural y los demás el determinista', () => {
    const db = source();
    const secondary = track(openTarget());
    migrateSecondaryLocal({ source: db.client, target: secondary, now: T, pathExists: exists });
    const games = new Map(
      legacyIds(secondary)
        .filter((row) => row.legacyTable === 'games')
        .map((row) => [Number(row.legacyId), String(row.newId)]),
    );
    assert.equal(games.get(1), gameIdForIgdb(100));
    assert.equal(games.get(3), gameIdForIgdb(300));
    assert.equal(games.get(2), legacyUuid('games', 2));
    assert.equal(games.get(4), legacyUuid('games', 4));
  });

  it('es idempotente: repetirla no cambia nada', () => {
    const db = source();
    const migrated = track(openTarget());
    importLegacyDatabase({
      source: db.client,
      target: migrated,
      claimInstalls: true,
      pathExists: exists,
      now: T,
    });
    const secondary = track(openTarget());
    pullFrom(migrated, secondary);
    const options = { source: db.client, target: secondary, now: T, pathExists: exists };
    migrateSecondaryLocal(options);
    const before = JSON.stringify([legacyIds(secondary), installs(secondary)]);
    const again = migrateSecondaryLocal({ ...options, now: T + DAY });
    assert.equal(again.legacyIdsWritten, 0);
    assert.equal(again.installs.games + again.installs.emulators, 0);
    assert.equal(JSON.stringify([legacyIds(secondary), installs(secondary)]), before);
  });

  it('un juego de la 1.x que aún no ha bajado del hub no se reclama (no hay clave foránea que valga)', () => {
    const db = source();
    const migrated = track(openTarget());
    importLegacyDatabase({
      source: db.client,
      target: migrated,
      claimInstalls: true,
      pathExists: exists,
      now: T,
    });
    const secondary = track(openTarget());
    pullFrom(migrated, secondary);
    // El juego con la ruta que existe todavía no ha llegado.
    secondary.db.$client.prepare(`DELETE FROM games WHERE title = 'Con IGDB'`).run();

    const report = migrateSecondaryLocal({
      source: db.client,
      target: secondary,
      now: T,
      pathExists: exists,
    });
    assert.equal(report.gamesNotInHub, 1);
    assert.equal(report.installs.games, 0);
    assert.equal(all(secondary, 'SELECT * FROM game_installs').length, 0);
    // El mapa sí se completa: cuando el juego llegue, ya se sabrá cuál es.
    assert.equal(legacyIds(secondary).length, 6);
  });
});
