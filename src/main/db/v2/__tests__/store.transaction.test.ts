import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { LocalDatabase } from '../connection';
import { isStoreError, type StoreChange } from '../store';
import { T0, count, openTestDb, rawRow, seedBasics, sqliteError } from './helpers';

// `transaction` (§8.6) y el aviso de cambios (§15.4, §8.5).

let local: LocalDatabase;
let changes: StoreChange[];
let listenerErrors: unknown[];
beforeEach(() => {
  listenerErrors = [];
  local = openTestDb({ onListenerError: (error) => listenerErrors.push(error) });
  changes = [];
  local.store.onChange((change) => changes.push(change));
});
afterEach(() => local.close());

describe('transaction: atomicidad', () => {
  it('si falla a mitad no queda nada, y el reloj sigue por delante de lo deshecho', () => {
    const { gameId } = seedBasics(local.store);
    const before = local.clock.peek();
    let inside = '';
    assert.throws(
      () =>
        local.store.transaction(() => {
          local.store.create('games', { title: 'Hades', addedAt: new Date(T0) });
          local.store.patch('games', gameId, { notes: 'x' });
          local.store.create('plan_entries', { gameId, plannedAt: new Date(T0) });
          inside = local.clock.peek();
          throw new Error('fallo a mitad');
        }),
      /fallo a mitad/,
    );
    assert.equal(count(local, 'games'), 1);
    assert.equal(count(local, 'plan_entries'), 0);
    assert.equal(rawRow(local, 'games', gameId)?.notes, null);
    assert.equal(local.db.$client.isTransaction, false);
    // El reloj no retrocede: la siguiente escritura queda por encima de todo
    // lo que se usó dentro de la transacción deshecha.
    assert.ok(inside > before);
    local.store.patch('games', gameId, { notes: 'y' });
    assert.ok(String(rawRow(local, 'games', gameId)?.syncUpdated) > inside);
  });

  it('un fallo de SQLite en la segunda escritura deshace la primera', () => {
    seedBasics(local.store);
    assert.throws(
      () =>
        local.store.transaction(() => {
          local.store.create('emulators', { name: 'Dolphin' });
          local.store.create('playthroughs', {
            gameId: 'no-existe',
            playedPlatform: 'PC',
            origin: 'x',
          });
        }),
      sqliteError(/FOREIGN KEY/),
    );
    assert.equal(count(local, 'emulators'), 0);
  });

  it('cada escritura suelta ya es atómica: la cascada entera o nada', () => {
    const { gameId } = seedBasics(local.store);
    // Un playthrough que la cascada no podría marcar: se fuerza un fallo
    // corrompiendo su syncFields; la lápida del juego también se deshace.
    local.db.$client.prepare(`UPDATE playthroughs SET syncFields = '{"rating":"roto"}'`).run();
    assert.throws(() => local.store.remove('games', gameId), /reloj mal formado/);
    assert.equal(rawRow(local, 'games', gameId)?.syncDeleted, null);
  });

  it('dentro, los relojes son estrictamente crecientes', () => {
    seedBasics(local.store);
    const ids = local.store.transaction(() =>
      Array.from({ length: 50 }, (_, i) => local.store.create('emulators', { name: `e${i}` }).id),
    );
    const clocks = ids.map((id) => String(rawRow(local, 'emulators', id)?.syncCreated));
    for (let i = 1; i < clocks.length; i++) assert.ok(clocks[i] > clocks[i - 1]);
  });

  it('anidada: si la interna falla y se captura, solo se deshace la interna', () => {
    seedBasics(local.store);
    changes.length = 0;
    const outer = local.store.transaction(() => {
      const kept = local.store.create('emulators', { name: 'Dolphin' }).id;
      try {
        local.store.transaction(() => {
          local.store.create('emulators', { name: 'PCSX2' });
          throw new Error('interna');
        });
      } catch {
        // la externa sigue
      }
      return kept;
    });
    assert.equal(count(local, 'emulators'), 1);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].ids.emulators, [outer]);
  });

  it('una función asíncrona se rechaza y no deja nada', () => {
    seedBasics(local.store);
    assert.throws(
      () =>
        local.store.transaction(() => {
          local.store.create('emulators', { name: 'Dolphin' });
          return Promise.resolve(1);
        }),
      (error) => isStoreError(error, 'transaction'),
    );
    assert.equal(count(local, 'emulators'), 0);
  });

  it('no trabaja dentro de una transacción ajena', () => {
    seedBasics(local.store);
    assert.throws(
      () =>
        local.db.transaction(() => {
          local.store.create('emulators', { name: 'Dolphin' });
        }),
      (error) => isStoreError(error, 'transaction'),
    );
    assert.equal(count(local, 'emulators'), 0);
  });

  it('las tablas locales se pueden escribir dentro de una transacción de la puerta', () => {
    seedBasics(local.store);
    assert.throws(() =>
      local.store.transaction(() => {
        local.store.create('emulators', { name: 'Dolphin' });
        local.db.$client.prepare(`INSERT INTO local_job_state (job) VALUES ('x')`).run();
        throw new Error('deshacer');
      }),
    );
    assert.equal(count(local, 'local_job_state'), 0);
  });
});

// Revisión, hallazgo 3 (venían de __review__/store.review.test.ts).
describe('transaction: funciones asíncronas', () => {
  it('no deja escrito NADA de una transacción rechazada por ser async', async () => {
    const { gameId } = seedBasics(local.store);
    let thrown: unknown = null;
    try {
      // Error de programación verosímil: alguien añade un `await` dentro.
      local.store.transaction((async () => {
        local.store.patch('games', gameId, { notes: 'antes del await' });
        await Promise.resolve();
        local.store.patch('games', gameId, { title: 'después del await' });
      }) as unknown as () => void);
    } catch (error) {
      thrown = error;
    }
    assert.ok(isStoreError(thrown, 'transaction'), 'la puerta rechaza la función async');
    // Dejar correr la continuación de la función async, si la hubiera.
    await new Promise((resolve) => setImmediate(resolve));
    const row = rawRow(local, 'games', gameId);
    assert.equal(row?.notes, null, 'lo de antes del await no se escribió');
    assert.equal(row?.title, 'Celeste', 'lo de después del await no se escribió');
    assert.equal(changes.length, 4, 'solo los avisos de seedBasics');
  });

  it('si una función normal devuelve la promesa de otra async, su continuación no puede escribir', async () => {
    const { gameId } = seedBasics(local.store);
    let continuation: unknown = 'no llegó a correr';
    const inner = async (): Promise<void> => {
      local.store.patch('games', gameId, { notes: 'antes del await' });
      await Promise.resolve();
      try {
        local.store.patch('games', gameId, { title: 'después del await' });
        continuation = null;
      } catch (error) {
        continuation = error;
      }
    };
    assert.throws(
      () => local.store.transaction(() => inner()),
      (error) => isStoreError(error, 'transaction'),
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(isStoreError(continuation, 'transaction'), 'la puerta está bloqueada');
    const row = rawRow(local, 'games', gameId);
    assert.equal(row?.notes, null, 'lo de antes del await se deshizo');
    assert.equal(row?.title, 'Celeste', 'lo de después del await no se escribió');
    // En la siguiente vuelta del bucle de eventos la puerta vuelve a funcionar.
    await new Promise((resolve) => setImmediate(resolve));
    local.store.patch('games', gameId, { notes: 'ya se puede' });
    assert.equal(rawRow(local, 'games', gameId)?.notes, 'ya se puede');
  });
});

// Revisión, hallazgo 4 (venía de __review__/store.review.test.ts).
describe('transaction: SQLite deshace la transacción entera', () => {
  /** Simula un error que hace a SQLite deshacer TODA la transacción (SQLITE_FULL, IOERR, NOMEM). */
  const armBoom = (): void =>
    local.db.$client.exec(
      `CREATE TEMP TRIGGER boom BEFORE UPDATE OF notes ON games
         WHEN NEW.notes = 'BOOM' BEGIN SELECT RAISE(ROLLBACK, 'disco lleno simulado'); END`,
    );

  it('una escritura capturada por quien llama no acaba confirmada fuera de la transacción', () => {
    const { gameId } = seedBasics(local.store);
    armBoom();
    let inner: unknown = null;
    let outer: unknown = null;
    try {
      local.store.transaction(() => {
        local.store.patch('games', gameId, { title: 'A (parte 1 de la operación)' });
        try {
          local.store.patch('games', gameId, { notes: 'BOOM' });
        } catch (error) {
          // Quien llama trata el fallo de la parte interna como opcional.
          inner = error;
        }
        local.store.patch('games', gameId, { title: 'B (parte 2 de la operación)' });
        throw new Error('la operación externa falla y debe deshacerse entera');
      });
    } catch (error) {
      outer = error;
    }
    // El error de dentro dice que la transacción se perdió y conserva el original.
    assert.ok(isStoreError(inner, 'aborted'));
    assert.ok(sqliteError(/disco lleno simulado/)((inner as Error).cause));
    // La parte 2 ya no pudo escribir: la externa falla con `aborted`.
    assert.ok(isStoreError(outer, 'aborted'));
    assert.equal(rawRow(local, 'games', gameId)?.title, 'Celeste');
    assert.equal(local.db.$client.isTransaction, false);
  });

  it('tampoco confirma si quien llama se traga todos los errores y devuelve con normalidad', () => {
    const { gameId } = seedBasics(local.store);
    armBoom();
    changes.length = 0;
    assert.throws(
      () =>
        local.store.transaction(() => {
          local.store.patch('games', gameId, { title: 'A' });
          try {
            local.store.patch('games', gameId, { notes: 'BOOM' });
          } catch {
            // se ignora
          }
          try {
            local.store.patch('games', gameId, { title: 'B' });
          } catch {
            // se ignora también
          }
          return 'ok';
        }),
      (error) => isStoreError(error, 'aborted'),
    );
    assert.equal(rawRow(local, 'games', gameId)?.title, 'Celeste');
    assert.equal(changes.length, 0, 'no se avisa de nada');
    // Y la puerta sigue funcionando después.
    local.store.patch('games', gameId, { title: 'C' });
    assert.equal(rawRow(local, 'games', gameId)?.title, 'C');
  });

  it('fuera de una transacción anidada, el error original sale tal cual', () => {
    const { gameId } = seedBasics(local.store);
    armBoom();
    assert.throws(
      () => local.store.patch('games', gameId, { notes: 'BOOM' }),
      sqliteError(/disco lleno simulado/),
    );
    assert.equal(local.db.$client.isTransaction, false);
  });
});

describe('aviso de cambios', () => {
  it('una escritura suelta avisa una vez, ya confirmada', () => {
    let inTransaction: boolean | undefined;
    local.store.onChange(() => {
      inTransaction = local.db.$client.isTransaction;
    });
    const { gameId } = seedBasics(local.store);
    changes.length = 0;
    local.store.patch('games', gameId, { notes: 'x' });
    assert.deepEqual(changes, [{ tables: ['games'], ids: { games: [gameId] } }]);
    assert.equal(inTransaction, false);
  });

  it('una transacción avisa una sola vez con todo lo tocado, cascada incluida', () => {
    const { gameId, playthroughId } = seedBasics(local.store);
    changes.length = 0;
    local.store.transaction(() => {
      local.store.patch('games', gameId, { notes: 'x' });
      local.store.patch('games', gameId, { notes: 'y' });
      local.store.remove('playthroughs', playthroughId);
    });
    assert.equal(changes.length, 1);
    assert.deepEqual([...changes[0].tables].sort(), ['games', 'playthroughs']);
    assert.deepEqual(changes[0].ids.games, [gameId]);
    assert.deepEqual(changes[0].ids.playthroughs, [playthroughId]);
  });

  it('ni lo que no cambia nada ni lo que se deshace avisa', () => {
    const { gameId } = seedBasics(local.store);
    changes.length = 0;
    local.store.patch('games', gameId, { title: 'Celeste' });
    local.store.create('games', { title: 'Celeste', igdbId: 26226, addedAt: new Date(T0) });
    assert.deepEqual(changes, []);
    local.store.remove('games', gameId);
    changes.length = 0;
    local.store.remove('games', gameId);
    assert.throws(() =>
      local.store.transaction(() => {
        local.store.create('emulators', { name: 'x' });
        throw new Error('no');
      }),
    );
    assert.deepEqual(changes, []);
  });

  it('un oyente que falla no hace fallar la escritura ni a los demás oyentes', () => {
    seedBasics(local.store);
    let reached = false;
    local.store.onChange(() => {
      throw new Error('oyente roto');
    });
    local.store.onChange(() => {
      reached = true;
    });
    const { id } = local.store.create('emulators', { name: 'Dolphin' });
    assert.ok(rawRow(local, 'emulators', id));
    assert.ok(reached);
    assert.equal(listenerErrors.length, 1);
  });

  it('se puede quitar un oyente', () => {
    const seen: StoreChange[] = [];
    const off = local.store.onChange((change) => seen.push(change));
    seedBasics(local.store);
    off();
    local.store.create('emulators', { name: 'x' });
    assert.equal(seen.length, 4);
  });
});
