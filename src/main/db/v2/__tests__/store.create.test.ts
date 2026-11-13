import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BOTTOM, parseClock } from '../../../../shared/sync/clock';
import { expandClocks, parseSyncFields } from '../../../../shared/sync/fieldClocks';
import {
  achievementUnlockId,
  gameIdForIgdb,
  isUuid,
  saveBackupId,
  uuidv5,
} from '../../../../shared/sync/ids';
import type { LocalDatabase } from '../connection';
import { registry, syncedEntries, type SyncedTableName } from '../registry';
import { isStoreError, type StoreErrorCode } from '../store';
import { tableInfo } from '../store/columns';
import { ID_BUILDERS } from '../store/ids';
import { LOCAL, T0, count, markClean, openTestDb, rawRow, seedBasics } from './helpers';

// `create` (§7.2, §8.3): relojes de creación, BOTTOM en lo no indicado (H-2),
// "escribir encima" con id determinista, resurrección y validaciones.

let local: LocalDatabase;
beforeEach(() => {
  local = openTestDb();
});
afterEach(() => local.close());

const fails = (code: StoreErrorCode) => (error: unknown) => isStoreError(error, code);

/** Relojes explícitos de una fila guardada. */
const clocksOf = (table: SyncedTableName, id: string): Record<string, string> => {
  const row = rawRow(local, table, id);
  assert.ok(row, `${table}/${id} no existe`);
  return expandClocks(
    {
      syncCreated: String(row.syncCreated),
      syncFields: parseSyncFields(String(row.syncFields)),
    },
    tableInfo(registry[table].table).dataColumns,
  );
};

describe('create: relojes', () => {
  it('lo indicado lleva el reloj de creación y lo no indicado BOTTOM, DEFAULT incluidos', () => {
    seedBasics(local.store);
    const before = local.clock.peek();
    const { id, outcome, changed } = local.store.create('games', {
      title: 'Hades',
      igdbId: 113112,
      addedAt: new Date(T0),
      notes: null,
    });
    assert.equal(outcome, 'created');
    assert.deepEqual([...changed].sort(), ['addedAt', 'igdbId', 'notes', 'title']);

    const row = rawRow(local, 'games', id);
    assert.ok(row);
    const created = String(row.syncCreated);
    assert.ok(created > before);
    assert.equal(row.syncUpdated, created);
    assert.equal(row.syncDeleted, null);
    assert.equal(row.syncDirty, 1);
    // El DEFAULT se escribe (la fila está completa) pero como "nadie lo ha escrito".
    assert.equal(row.endless, 0);

    const clocks = clocksOf('games', id);
    for (const column of ['title', 'igdbId', 'addedAt', 'notes', 'syncDeleted']) {
      assert.equal(clocks[column], created, column);
    }
    for (const column of [
      'endless',
      'isEmulated',
      'saveBackupEnabled',
      'coverOverride',
      'saveKey',
    ]) {
      assert.equal(clocks[column], BOTTOM, column);
    }
    // Forma compacta (§7.3): solo lo distinto de syncCreated.
    const syncFields = parseSyncFields(String(row.syncFields));
    assert.ok(!('title' in syncFields) && !('syncDeleted' in syncFields));
    assert.equal(syncFields.endless, BOTTOM);
  });

  it('un DEFAULT indicado explícitamente lleva reloj de creación', () => {
    seedBasics(local.store);
    const { id } = local.store.create('games', {
      title: 'Hades',
      addedAt: new Date(T0),
      endless: false,
    });
    const clocks = clocksOf('games', id);
    assert.equal(clocks.endless, String(rawRow(local, 'games', id)?.syncCreated));
    assert.equal(clocks.isEmulated, BOTTOM);
  });

  it('los relojes de varias creaciones son estrictamente crecientes con el reloj de pared parado', () => {
    seedBasics(local.store);
    const created: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { id } = local.store.create('emulators', { name: `emu ${i}` });
      created.push(String(rawRow(local, 'emulators', id)?.syncCreated));
    }
    for (let i = 1; i < created.length; i++) assert.ok(created[i] > created[i - 1]);
    assert.equal(parseClock(created[0]).ms, T0);
    assert.equal(parseClock(created[0]).dev, local.shortDeviceId);
  });
});

describe('create: escribir encima (id determinista o compuesto)', () => {
  it('H-2: repetir el alta no pisa con vacíos lo que ya había', () => {
    seedBasics(local.store);
    const values = { title: 'Hollow Knight', igdbId: 14593, addedAt: new Date(T0) };
    const { id } = local.store.create('games', values);
    local.store.patch('games', id, { notes: 'mis notas', endless: true });
    markClean(local, 'games');
    const before = rawRow(local, 'games', id);
    const clockBefore = local.clock.peek();

    // El mismo juego añadido otra vez (otra búsqueda en IGDB, otro PC que no
    // lo sabía): mismos valores, sin notas ni endless.
    const again = local.store.create('games', values);
    assert.equal(again.id, id);
    assert.equal(again.outcome, 'unchanged');
    assert.deepEqual(again.changed, []);
    assert.deepEqual(rawRow(local, 'games', id), before);
    assert.equal(local.clock.peek(), clockBefore, 'no gasta reloj');

    // Con un título distinto solo cambia el título.
    const renamed = local.store.create('games', { ...values, title: 'Hollow Knight (GOTY)' });
    assert.equal(renamed.outcome, 'updated');
    assert.deepEqual(renamed.changed, ['title']);
    const row = rawRow(local, 'games', id);
    assert.equal(row?.notes, 'mis notas');
    assert.equal(row?.endless, 1);
    assert.equal(row?.syncDirty, 1);
    assert.equal(
      row?.syncCreated,
      before?.syncCreated,
      'syncCreated es el de la creación más antigua',
    );
    const clocks = clocksOf('games', id);
    assert.equal(clocks.title, row?.syncUpdated);
    assert.ok(clocks.notes < clocks.title);
  });

  it('resucita una fila con lápida; sus hijos siguen borrados', () => {
    const { gameId, playthroughId } = seedBasics(local.store);
    const created = String(rawRow(local, 'games', gameId)?.syncCreated);
    local.store.remove('games', gameId);
    const tombstone = String(rawRow(local, 'games', gameId)?.syncDeleted);
    assert.notEqual(tombstone, 'null');

    const result = local.store.create('games', {
      title: 'Celeste',
      igdbId: 26226,
      addedAt: new Date(T0),
    });
    assert.equal(result.id, gameId);
    assert.equal(result.outcome, 'resurrected');
    assert.deepEqual(result.changed, []);

    const row = rawRow(local, 'games', gameId);
    assert.equal(row?.syncDeleted, null);
    assert.equal(row?.syncCreated, created);
    const clocks = clocksOf('games', gameId);
    assert.ok(clocks.syncDeleted > tombstone, 'la resurrección lleva reloj nuevo');
    assert.equal(row?.syncUpdated, clocks.syncDeleted);
    assert.notEqual(rawRow(local, 'playthroughs', playthroughId)?.syncDeleted, null);
  });

  it('devices (id given) también escribe encima: el PC se registra en cada arranque', () => {
    seedBasics(local.store);
    const result = local.store.create('devices', {
      id: LOCAL,
      name: 'PC-A',
      kind: 'desktop',
      os: 'windows',
      firstSeenAt: new Date(T0),
      appVersion: '2.0.0',
    });
    assert.equal(result.outcome, 'updated');
    assert.deepEqual(result.changed, ['appVersion']);
  });

  it('con id aleatorio, que ya exista es un error', () => {
    const { gameId } = seedBasics(local.store);
    const id = '0194c2f0-1234-7abc-8def-0123456789ab';
    local.store.create('playthroughs', { id, gameId, playedPlatform: 'PC', origin: 'Steam' });
    assert.throws(
      () =>
        local.store.create('playthroughs', { id, gameId, playedPlatform: 'PC', origin: 'Steam' }),
      fails('exists'),
    );
  });
});

describe('create: ids (§7.2)', () => {
  it('cada tabla forma su id como dicen el registro y ids.ts', () => {
    const { gameId } = seedBasics(local.store);
    assert.equal(gameId, gameIdForIgdb(26226));

    const plain = local.store.create('games', { title: 'Sin IGDB', addedAt: new Date(T0) });
    assert.ok(isUuid(plain.id));
    assert.equal(plain.id[14], '7', 'UUIDv7');

    assert.equal(local.store.create('game_metadata', { gameId, summary: 'x' }).id, gameId);
    assert.equal(
      local.store.create('external_checks', {
        gameId,
        source: 'igdb',
        status: 'ok',
        checkedAt: new Date(T0),
      }).id,
      `${gameId}:igdb`,
    );
    assert.equal(
      local.store.create('game_installs', { gameId, deviceId: LOCAL }).id,
      `${gameId}:${LOCAL}`,
    );
    // apiName puede llevar ':' (lo fija Steam, no nosotros).
    assert.equal(
      local.store.create('achievement_unlocks', {
        gameId,
        source: 'steam',
        apiName: 'ACH:1',
        origin: 'steam',
        unlockedAt: new Date(T0),
      }).id,
      achievementUnlockId(gameId, 'steam', 'ACH:1', 'steam'),
    );
    assert.equal(
      local.store.create('save_backups', {
        gameId,
        deviceId: LOCAL,
        backupName: 'b',
        r2Key: 'saves/x/b.zip',
        ludusaviName: 'Celeste',
        createdAt: new Date(T0),
      }).id,
      saveBackupId('saves/x/b.zip'),
    );
    assert.equal(
      local.store.create('radar_games', {
        igdbId: 42,
        title: 'Secuela',
        discoveredAt: new Date(T0),
      }).id,
      'igdb:42',
    );
  });

  it('en las tablas 1:1 con un juego, un id distinto de gameId se rechaza', () => {
    const { gameId } = seedBasics(local.store);
    assert.throws(
      () => local.store.create('plan_entries', { id: 'otro', gameId, plannedAt: new Date(T0) }),
      fails('id_mismatch'),
    );
    assert.equal(
      local.store.create('plan_entries', { id: gameId, gameId, plannedAt: new Date(T0) }).id,
      gameId,
    );
  });

  it('devices exige el id; los aleatorios solo aceptan UUID en minúsculas', () => {
    const { gameId } = seedBasics(local.store);
    assert.throws(
      () =>
        local.store.create('devices', {
          name: 'x',
          kind: 'desktop',
          os: 'windows',
          firstSeenAt: new Date(T0),
        }),
      fails('incomplete'),
    );
    for (const id of ['abc', '0194C2F0-1234-7ABC-8DEF-0123456789AB', '']) {
      assert.throws(
        () => local.store.create('playthroughs', { id, gameId, playedPlatform: 'PC', origin: 'x' }),
        fails('invalid_value'),
        id,
      );
    }
  });

  it('una parte de id inválida es un valor inválido, no un fallo interno', () => {
    seedBasics(local.store);
    assert.throws(
      () =>
        local.store.create('radar_games', { igdbId: -1, title: 'x', discoveredAt: new Date(T0) }),
      fails('invalid_value'),
    );
  });

  it('cada constructor de id coincide con las partes del registro', () => {
    // Valores de ejemplo sin ':' (con ':' la lectura genérica no sabe qué
    // parte es la libre; por eso existen los constructores).
    const sample: Record<string, string | number> = {
      gameId: 'g1',
      source: 'steam',
      deviceId: 'd1',
      emulatorId: 'e1',
      apiName: 'ACH_1',
      origin: 'emu@d1',
      r2Key: 'saves/k.zip',
      scopeType: 'month',
      scopeKey: '2026-06',
      igdbId: 42,
    };
    for (const entry of syncedEntries) {
      const builder = ID_BUILDERS[entry.name as SyncedTableName] as
        ((values: Record<string, unknown>) => string | null) | undefined;
      if (entry.id.kind !== 'deterministic' && entry.id.kind !== 'composite') {
        assert.equal(builder, undefined, `${entry.name} no debería tener constructor`);
        continue;
      }
      assert.ok(builder, `${entry.name} necesita constructor`);
      const parts = entry.id.parts.map((part) =>
        'literal' in part ? part.literal : String(sample[part.column]),
      );
      const expected =
        entry.id.kind === 'deterministic'
          ? uuidv5(parts.join(':'))
          : parts.length === 1
            ? parts[0]
            : parts.join(':');
      assert.equal(builder(sample), expected, entry.name);
    }
  });
});

describe('create: validaciones', () => {
  it('rechaza creaciones incompletas antes de llegar a SQLite', () => {
    seedBasics(local.store);
    assert.throws(
      () => local.store.create('games', { addedAt: new Date(T0) } as never),
      (error) => isStoreError(error, 'incomplete') && /title/.test(error.message),
    );
    assert.throws(
      () => local.store.create('games', { title: null, addedAt: new Date(T0) } as never),
      fails('incomplete'),
    );
    // Con DEFAULT se puede omitir, pero no indicar null.
    assert.throws(
      () =>
        local.store.create('games', { title: 'x', addedAt: new Date(T0), endless: null } as never),
      fails('incomplete'),
    );
    assert.equal(count(local, 'games'), 1);
  });

  it('rechaza tipos equivocados, enumeraciones fuera de rango, NaN y fechas inválidas', () => {
    const { gameId } = seedBasics(local.store);
    const bad: [string, Record<string, unknown>][] = [
      ['games', { title: 1, addedAt: new Date(T0) }],
      ['games', { title: 'x', addedAt: T0 }],
      ['games', { title: 'x', addedAt: new Date(Number.NaN) }],
      ['games', { title: 'x', addedAt: new Date(T0), endless: 1 }],
      ['games', { title: 'x', addedAt: new Date(T0), igdbId: 1.5 }],
      ['games', { title: 'x', addedAt: new Date(T0), steamAppIdSource: 'otro' }],
      ['playthroughs', { gameId, playedPlatform: 'PC', origin: 'x', manualHours: Number.NaN }],
      ['playthroughs', { gameId, playedPlatform: 'PC', origin: 'x', manualHours: Infinity }],
      ['games', { title: 'x', addedAt: new Date(T0), genresOverride: () => 1 }],
    ];
    for (const [table, values] of bad) {
      assert.throws(
        () => local.store.create(table as 'games', values as never),
        fails('invalid_value'),
        JSON.stringify(values),
      );
    }
  });

  it('rechaza columnas desconocidas y las de sincronización', () => {
    seedBasics(local.store);
    for (const extra of [{ foo: 1 }, { syncDirty: false }, { syncDeleted: null }]) {
      assert.throws(
        () => local.store.create('games', { title: 'x', addedAt: new Date(T0), ...extra } as never),
        fails('unknown_column'),
      );
    }
  });

  it('rechaza tablas que no son sincronizadas', () => {
    assert.throws(
      () => local.store.create('local_job_state' as never, {} as never),
      fails('unknown_table'),
    );
  });
});
