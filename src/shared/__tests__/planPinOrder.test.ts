import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planPinOrder } from '../planPinOrder';

const pinned = (id: number, stamp: number | null): { id: number; planPinnedAt: Date | null } => ({
  id,
  planPinnedAt: stamp === null ? null : new Date(stamp),
});

describe('planPinOrder', () => {
  it('reparte las mismas fechas en el orden solicitado sin mutar los juegos', () => {
    const games = [pinned(1, 100), pinned(2, 200), pinned(3, 300)];
    const before = structuredClone(games);
    Object.freeze(games);
    assert.deepEqual(
      [...planPinOrder(games, [3, 1, 2])],
      [
        [3, 100],
        [1, 200],
        [2, 300],
      ],
    );
    assert.deepEqual(games, before);
  });

  it('deduplica antes de contar y no inventa reordenación con cero o un pin', () => {
    const games = [pinned(1, 100), pinned(2, null)];
    for (const ids of [[], [1], [1, 1], [2, 99], [1, 2, 99, 1]]) {
      assert.equal(planPinOrder(games, ids).size, 0);
    }
  });

  it('ignora ids borrados o soltados conservando la primera posición repetida', () => {
    const games = [pinned(1, 100), pinned(2, 200), pinned(3, null), pinned(4, 400)];
    assert.deepEqual(
      [...planPinOrder(games, [2, 99, 3, 2, 1])],
      [
        [2, 100],
        [1, 200],
      ],
    );
    assert.equal(games[3].planPinnedAt?.getTime(), 400);
  });

  it('desempata milisegundos de forma estrictamente creciente', () => {
    const games = [pinned(1, 100), pinned(2, 100), pinned(3, 101), pinned(4, 104)];
    assert.deepEqual(
      [...planPinOrder(games, [4, 3, 2, 1])],
      [
        [4, 100],
        [3, 101],
        [2, 102],
        [1, 104],
      ],
    );
  });
});
