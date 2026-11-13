import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, describe, it } from 'node:test';
import { maxStoredClock } from '../connection';
import { T0, count, fakeWall, openTestDb, seedBasics, tempDir } from './helpers';

// Volumen moderado, para tener una referencia de tiempos (no es un banco de
// pruebas: los números solo se imprimen). Sobre un fichero de verdad, con WAL
// y `synchronous = FULL`, como la app.

const N = 5000;
const dir = tempDir();
after(() => dir.cleanup());

const time = <T>(label: string, fn: () => T): T => {
  const start = performance.now();
  const result = fn();
  console.log(`[volumen] ${label}: ${(performance.now() - start).toFixed(1)} ms`);
  return result;
};

describe('puerta de escritura: volumen', () => {
  it(`${N} creaciones y ${N} parches en una transacción`, () => {
    const path = join(dir.path, 'Afterplay2.db');
    const wall = fakeWall(T0);
    const local = openTestDb({ path, wall: wall.wall });
    let ids: string[] = [];
    try {
      seedBasics(local.store);
      ids = time(`${N} creaciones (games)`, () =>
        local.store.transaction(() =>
          Array.from(
            { length: N },
            (_, i) =>
              local.store.create('games', {
                title: `Juego ${i}`,
                igdbId: 100_000 + i,
                addedAt: new Date(T0 + i),
                genresOverride: ['RPG'],
              }).id,
          ),
        ),
      );
      wall.advance(1000);
      time(`${N} parches con cambio`, () =>
        local.store.transaction(() => {
          for (const id of ids) local.store.patch('games', id, { notes: 'nota', endless: true });
        }),
      );
      const clock = local.clock.peek();
      time(`${N} parches sin cambio (refresco semanal, F-33)`, () =>
        local.store.transaction(() => {
          for (const id of ids) {
            local.store.patch('games', id, { notes: 'nota', genresOverride: ['RPG'] });
          }
        }),
      );
      assert.equal(local.clock.peek(), clock, 'los parches sin cambio no gastan reloj');
      time(`${N} creaciones repetidas (mismo id, sin cambios)`, () =>
        local.store.transaction(() => {
          for (let i = 0; i < N; i++) {
            local.store.create('games', {
              title: `Juego ${i}`,
              igdbId: 100_000 + i,
              addedAt: new Date(T0 + i),
            });
          }
        }),
      );
      time('mayor reloj de la base (arranque, §8.2)', () => maxStoredClock(local.db));
      time('100 escrituras sueltas (una transacción y un fsync cada una)', () => {
        for (let i = 0; i < 100; i++) local.store.patch('games', ids[i], { notes: `n${i}` });
      });
      assert.equal(count(local, 'games'), N + 1);
      assert.equal(count(local, 'games', 'syncDirty = 1'), N + 1);
    } finally {
      local.close();
    }
    const reopened = time('reabrir el fichero (migrador + reloj)', () => openTestDb({ path }));
    try {
      assert.ok(reopened.clock.now() > maxStoredClock(reopened.db));
    } finally {
      reopened.close();
    }
  });
});
