import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { LocalDatabase } from '../connection';
import { WriteStore, type StoreChange } from '../store';
import { T0, count, openTestDb, rawRow, seedBasics } from './helpers';

// La puerta con el ejecutor de transacciones del anfitrión (`transactionRunner`),
// que es como trabaja dentro del Durable Object del hub (§13.3). Aquí el
// ejecutor imita a `ctx.storage.transactionSync`: anidable con SAVEPOINT y sin
// que la puerta escriba BEGIN ni SAVEPOINT por su cuenta.

let local: LocalDatabase;
let store: WriteStore;
let changes: StoreChange[];
let depth: number;

/** Lo que hace `transactionSync` de un Durable Object, sobre node:sqlite. */
function hostRunner<T>(fn: () => T): T {
  const client = local.db.$client;
  const name = `host_${depth}`;
  const outer = depth === 0;
  client.exec(outer ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth += 1;
  try {
    const result = fn();
    client.exec(outer ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (error) {
    if (outer) client.exec('ROLLBACK');
    else client.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw error;
  } finally {
    depth -= 1;
  }
}

beforeEach(() => {
  local = openTestDb();
  depth = 0;
  store = new WriteStore({
    db: local.db,
    clock: local.clock,
    deviceId: local.deviceId,
    transactionRunner: hostRunner,
  });
  changes = [];
  store.onChange((change) => changes.push(change));
});
afterEach(() => local.close());

describe('transactionRunner', () => {
  it('escribe y avisa una vez al terminar la exterior', () => {
    const { gameId } = seedBasics(store);
    changes = [];
    store.transaction(() => {
      store.patch('games', gameId, { notes: 'a' });
      store.create('plan_entries', { gameId, plannedAt: new Date(T0) });
    });
    assert.equal(rawRow(local, 'games', gameId)?.notes, 'a');
    assert.equal(changes.length, 1);
    assert.deepEqual([...changes[0].tables].sort(), ['games', 'plan_entries']);
  });

  it('si la exterior lanza no queda nada ni se avisa', () => {
    const { gameId } = seedBasics(store);
    changes = [];
    assert.throws(
      () =>
        store.transaction(() => {
          store.patch('games', gameId, { notes: 'x' });
          store.create('plan_entries', { gameId, plannedAt: new Date(T0) });
          throw new Error('fallo');
        }),
      /fallo/,
    );
    assert.equal(rawRow(local, 'games', gameId)?.notes, null);
    assert.equal(count(local, 'plan_entries'), 0);
    assert.deepEqual(changes, []);
  });

  it('una anidada que falla y se captura deshace solo lo suyo', () => {
    const { gameId } = seedBasics(store);
    changes = [];
    store.transaction(() => {
      store.patch('games', gameId, { notes: 'fuera' });
      try {
        store.transaction(() => {
          store.create('plan_entries', { gameId, plannedAt: new Date(T0) });
          throw new Error('dentro');
        });
      } catch {
        // Se captura: la exterior sigue.
      }
    });
    assert.equal(rawRow(local, 'games', gameId)?.notes, 'fuera');
    assert.equal(count(local, 'plan_entries'), 0);
    assert.deepEqual(changes[0].tables, ['games']);
  });

  it('trabaja dentro de una transacción del anfitrión, que es quien confirma', () => {
    const { gameId } = seedBasics(store);
    changes = [];
    assert.throws(() =>
      hostRunner(() => {
        store.patch('games', gameId, { notes: 'del anfitrión' });
        // El aviso sale al acabar la de la puerta, aún dentro de la del anfitrión.
        assert.equal(changes.length, 1);
        throw new Error('el anfitrión deshace');
      }),
    );
    assert.equal(rawRow(local, 'games', gameId)?.notes, null);
  });

  it('rechaza una función async igual que la de siempre', () => {
    assert.throws(
      () => store.transaction((async () => undefined) as unknown as () => void),
      /síncrona/,
    );
  });
});
