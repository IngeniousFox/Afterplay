import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { expandClocks, parseSyncFields } from '../../../../shared/sync/fieldClocks';
import type { LocalDatabase } from '../connection';
import { registry, type SyncedTableName } from '../registry';
import { isStoreError, type StoreErrorCode } from '../store';
import { tableInfo } from '../store/columns';
import {
  LOCAL,
  OTHER,
  T0,
  insertSynced,
  markClean,
  openTestDb,
  rawRow,
  seedBasics,
} from './helpers';

// `patch` (§8.6): solo lo que cambia recibe reloj; un parche sin cambios no
// escribe nada (F-33). La comparación se hace siempre con los valores tal
// como los devuelve Drizzle al leer, para cada tipo de columna del esquema.

let local: LocalDatabase;
let gameId: string;
let playthroughId: string;
beforeEach(() => {
  local = openTestDb();
  ({ gameId, playthroughId } = seedBasics(local.store));
});
afterEach(() => local.close());

const fails = (code: StoreErrorCode) => (error: unknown) => isStoreError(error, code);

const clocksOf = (table: SyncedTableName, id: string): Record<string, string> => {
  const row = rawRow(local, table, id);
  assert.ok(row);
  return expandClocks(
    { syncCreated: String(row.syncCreated), syncFields: parseSyncFields(String(row.syncFields)) },
    tableInfo(registry[table].table).dataColumns,
  );
};

describe('patch: sin cambios no escribe nada (F-33)', () => {
  it('no toca syncUpdated, ni syncDirty, ni syncFields, ni gasta reloj', () => {
    local.store.patch('games', gameId, { notes: 'hola', genresOverride: ['RPG'] });
    markClean(local, 'games');
    const before = rawRow(local, 'games', gameId);
    const clock = local.clock.peek();

    const { changed } = local.store.patch('games', gameId, {
      title: 'Celeste',
      notes: 'hola',
      genresOverride: ['RPG'],
      addedAt: new Date(T0),
      endless: false,
      igdbId: 26226,
      coverOverride: null,
      heroOverride: undefined,
    });
    assert.deepEqual(changed, []);
    assert.deepEqual(rawRow(local, 'games', gameId), before);
    assert.equal(local.clock.peek(), clock);
  });

  it('un parche vacío tampoco', () => {
    markClean(local, 'games');
    const before = rawRow(local, 'games', gameId);
    assert.deepEqual(local.store.patch('games', gameId, {}).changed, []);
    assert.deepEqual(rawRow(local, 'games', gameId), before);
  });
});

describe('patch: solo la columna que cambia recibe reloj', () => {
  it('cambia una columna y las demás conservan su reloj', () => {
    local.store.patch('games', gameId, { notes: 'a' });
    markClean(local, 'games');
    const before = clocksOf('games', gameId);
    const { changed } = local.store.patch('games', gameId, { notes: 'b', title: 'Celeste' });
    assert.deepEqual(changed, ['notes']);
    const after = clocksOf('games', gameId);
    const row = rawRow(local, 'games', gameId);
    assert.ok(after.notes > before.notes);
    assert.equal(after.notes, row?.syncUpdated);
    assert.equal(row?.syncDirty, 1);
    for (const column of Object.keys(before)) {
      if (column !== 'notes') assert.equal(after[column], before[column], column);
    }
  });

  it('una fila con reloj por delante del nuestro (llegada por sync) se parchea con un reloj mayor', () => {
    const future = `${T0 + 86_400_000}-0003-zzzzzz`;
    insertSynced(local, 'emulators', { id: 'emu-sync', name: 'RetroArch' }, future);
    local.store.patch('emulators', 'emu-sync', { name: 'RetroArch 2' });
    assert.ok(String(rawRow(local, 'emulators', 'emu-sync')?.syncUpdated) > future);
  });
});

describe('patch: cada tipo de columna se compara en la forma de lectura', () => {
  // Para cada tipo: [tabla, id, columna, valor, el mismo valor en otra
  // instancia (o en otra forma equivalente), un valor distinto].
  type Case = {
    readonly type: string;
    readonly table: SyncedTableName;
    readonly id: () => string;
    readonly column: string;
    readonly value: unknown;
    readonly same: unknown;
    readonly other: unknown;
  };
  const cases: Case[] = [
    {
      type: 'texto',
      table: 'games',
      id: () => gameId,
      column: 'notes',
      value: 'a',
      same: 'a',
      other: 'b',
    },
    {
      type: 'entero',
      table: 'games',
      id: () => gameId,
      column: 'steamAppId',
      value: 504230,
      same: 504230,
      other: 504231,
    },
    // 0 y -0 son el mismo número para la base.
    {
      type: 'real',
      table: 'playthroughs',
      id: () => playthroughId,
      column: 'manualHours',
      value: 0,
      same: -0,
      other: 1.5,
    },
    {
      type: 'booleano',
      table: 'games',
      id: () => gameId,
      column: 'isEmulated',
      value: true,
      same: true,
      other: false,
    },
    {
      type: 'fecha',
      table: 'games',
      id: () => gameId,
      column: 'promotedAt',
      value: new Date(T0 + 1),
      same: new Date(T0 + 1),
      other: new Date(T0 + 2),
    },
    {
      type: 'enumeración',
      table: 'games',
      id: () => gameId,
      column: 'steamAppIdSource',
      value: 'manual',
      same: 'manual',
      other: 'auto',
    },
    {
      type: 'JSON (lista)',
      table: 'games',
      id: () => gameId,
      column: 'genresOverride',
      value: ['RPG', 'Indie'],
      same: ['RPG', 'Indie'],
      other: ['Indie', 'RPG'],
    },
    {
      type: 'JSON (objetos: orden de claves y undefined no cuentan)',
      table: 'game_metadata',
      id: () => gameId,
      column: 'igdbCollections',
      value: [{ id: 1, name: 'Celeste' }],
      same: [{ name: 'Celeste', id: 1, extra: undefined }],
      other: [{ id: 1, name: 'Celeste Classic' }],
    },
    {
      type: 'null',
      table: 'games',
      id: () => gameId,
      column: 'coverOverride',
      value: null,
      same: null,
      other: 'https://img/x.png',
    },
  ];

  for (const c of cases) {
    it(c.type, () => {
      if (c.table === 'game_metadata') local.store.create('game_metadata', { gameId });
      const id = c.id();
      // Primero un valor distinto del que se va a probar, para partir de un
      // estado conocido (en el caso null, la columna ya es null).
      if (c.value !== null) local.store.patch(c.table, id, { [c.column]: c.other } as never);
      const first = local.store.patch(c.table, id, { [c.column]: c.value } as never);
      assert.deepEqual(first.changed, c.value === null ? [] : [c.column], 'primer valor');

      markClean(local, c.table);
      const before = rawRow(local, c.table, id);
      const same = local.store.patch(c.table, id, { [c.column]: c.same } as never);
      assert.deepEqual(same.changed, [], 'el mismo valor no cambia nada');
      assert.deepEqual(rawRow(local, c.table, id), before);

      const other = local.store.patch(c.table, id, { [c.column]: c.other } as never);
      assert.deepEqual(other.changed, [c.column], 'otro valor sí');
      assert.equal(rawRow(local, c.table, id)?.syncDirty, 1);
    });
  }

  it('lo leído por Drizzle tiene los tipos que compara la puerta', () => {
    local.store.patch('games', gameId, { promotedAt: new Date(T0), genresOverride: ['a'] });
    const raw = rawRow(local, 'games', gameId);
    // En SQLite: milisegundos, 0/1 y texto JSON.
    assert.equal(raw?.promotedAt, T0);
    assert.equal(raw?.endless, 0);
    assert.equal(raw?.genresOverride, '["a"]');
  });
});

describe('patch: errores', () => {
  it('fila inexistente: not_found', () => {
    assert.throws(
      () => local.store.patch('games', 'no-existe', { notes: 'x' }),
      fails('not_found'),
    );
  });

  it('fila con lápida: deleted (para revivirla está create)', () => {
    local.store.remove('playthroughs', playthroughId);
    assert.throws(
      () => local.store.patch('playthroughs', playthroughId, { rating: 5 }),
      fails('deleted'),
    );
  });

  it('null en una columna NOT NULL: incomplete', () => {
    assert.throws(
      () => local.store.patch('games', gameId, { title: null } as never),
      fails('incomplete'),
    );
  });

  it('columnas de sync, id o desconocidas: unknown_column', () => {
    for (const changes of [{ syncDeleted: null }, { syncDirty: false }, { id: 'x' }, { nope: 1 }]) {
      assert.throws(
        () => local.store.patch('games', gameId, changes as never),
        fails('unknown_column'),
        JSON.stringify(changes),
      );
    }
  });

  it('no se cambian las columnas del id calculado ni el dueño', () => {
    local.store.create('game_installs', { gameId, deviceId: LOCAL });
    local.store.create('external_checks', {
      gameId,
      source: 'hltb',
      status: 'ok',
      checkedAt: new Date(T0),
    });
    const installId = `${gameId}:${LOCAL}`;
    assert.throws(
      () => local.store.patch('game_installs', installId, { deviceId: OTHER }),
      fails('immutable'),
    );
    assert.throws(
      () => local.store.patch('external_checks', `${gameId}:hltb`, { source: 'igdb' }),
      fails('immutable'),
    );
    const { id: sessionId } = local.store.create('sessions', {
      playthroughId,
      deviceId: LOCAL,
      startedBy: 'play',
      startedAt: new Date(T0),
      endedAt: new Date(T0 + 60_000),
      datePrecision: 'datetime',
    });
    assert.throws(
      () => local.store.patch('sessions', sessionId, { deviceId: OTHER }),
      fails('immutable'),
    );
    // El mismo valor no es un cambio y no falla.
    assert.deepEqual(
      local.store.patch('game_installs', installId, { deviceId: LOCAL }).changed,
      [],
    );
    // games.igdbId no forma el id después de crear (§7.2: el juego conserva su id).
    assert.deepEqual(local.store.patch('games', gameId, { igdbId: 1 }).changed, ['igdbId']);
  });
});

// Revisión, hallazgo 2 (venía de __review__/store.review.test.ts). El test de
// la revisión pedía que una nota con NUL se leyera igual que se escribió: no
// se puede (el driver corta al leer), así que el contrato pasa a ser que la
// puerta la rechaza y no escribe nada.
describe('patch: textos con el carácter NUL', () => {
  it('una nota con \0 se rechaza con invalid_value y no se escribe', () => {
    assert.throws(
      () => local.store.patch('games', gameId, { notes: 'antes\u0000después' }),
      (error) => fails('invalid_value')(error) && /NUL/.test((error as Error).message),
    );
    assert.equal(rawRow(local, 'games', gameId)?.notes, null);
    // Tampoco al crear, ni en un id indicado por quien llama.
    assert.throws(
      () => local.store.create('games', { title: 'a\u0000b', addedAt: new Date(T0) }),
      fails('invalid_value'),
    );
    assert.throws(
      () =>
        local.store.create('devices', {
          id: 'pc\u0000c',
          name: 'PC-C',
          kind: 'desktop',
          os: 'windows',
          firstSeenAt: new Date(T0),
        }),
      fails('invalid_value'),
    );
  });

  it('en una columna JSON no hace falta: va escapado y se lee entero', () => {
    const genres = ['RPG\u0000con NUL'];
    local.store.patch('games', gameId, { genresOverride: genres });
    const stored = String(rawRow(local, 'games', gameId)?.genresOverride);
    assert.ok(!stored.includes('\u0000'), 'el texto guardado no lleva el byte nulo');
    assert.deepEqual(JSON.parse(stored), genres);
    // Y el parche igual no es un cambio (la lectura casa con lo escrito).
    assert.deepEqual(local.store.patch('games', gameId, { genresOverride: genres }).changed, []);
  });
});

// Revisión, hallazgo 7 (venía de __review__/connection.review.test.ts).
describe('patch: JSON que no se puede representar', () => {
  it('un Set, un Map o un Date en una columna JSON se rechazan en vez de guardarse como otra cosa', () => {
    for (const value of [new Set(['RPG']), new Map([['a', 1]]), new Date(T0), [1, Number.NaN]]) {
      assert.throws(
        () => local.store.patch('games', gameId, { genresOverride: value as unknown as string[] }),
        fails('invalid_value'),
        String(value),
      );
    }
    assert.equal(rawRow(local, 'games', gameId)?.genresOverride, null);
  });

  it('un objeto con claves undefined sí vale (JSON las quita y se comparan igual)', () => {
    local.store.patch('games', gameId, {
      saveCustomPaths: [{ path: 'C:/x', note: undefined }] as never,
    });
    assert.ok(rawRow(local, 'games', gameId)?.saveCustomPaths);
  });
});
