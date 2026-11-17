import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planWaitingSince, redistributePinStamps } from '../planOrder';

// Las reglas del orden del Plan, ya en UN solo sitio.

const T10 = new Date('2026-01-10T10:00:00Z').getTime();
const T12 = new Date('2026-01-10T12:00:00Z').getTime();

describe('redistributePinStamps: reordenar reparte las marcas que ya existen', () => {
  it('reparte el mismo multiset en el orden pedido sin mutar las filas', () => {
    const rows = Object.freeze([
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 200 },
      { id: 3, pinnedAt: 300 },
    ]);
    const before = structuredClone(rows);
    assert.deepEqual(
      [...redistributePinStamps(rows, [3, 1, 2])],
      [
        [3, 100],
        [1, 200],
        [2, 300],
      ],
    );
    assert.deepEqual(rows, before);
  });

  it('menos de dos fijados (tras deduplicar e ignorar desconocidos) no es un reorden', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: null },
    ];
    for (const ids of [[], [1], [1, 1], [2, 99], [1, 2, 99, 1]]) {
      assert.equal(redistributePinStamps(rows, ids).size, 0, `ids ${JSON.stringify(ids)}`);
    }
  });

  it('ignora soltados y borrados, y un repetido conserva su PRIMERA posición', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 200 },
      { id: 3, pinnedAt: null },
      { id: 4, pinnedAt: 400 },
    ];
    assert.deepEqual(
      [...redistributePinStamps(rows, [2, 99, 3, 2, 1])],
      [
        [2, 100],
        [1, 200],
      ],
    );
  });

  it('dos marcas en el mismo milisegundo salen estrictamente crecientes', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 100 },
      { id: 3, pinnedAt: 101 },
      { id: 4, pinnedAt: 104 },
    ];
    assert.deepEqual(
      [...redistributePinStamps(rows, [4, 3, 2, 1])],
      [
        [4, 100],
        [3, 101],
        [2, 102],
        [1, 104],
      ],
    );
  });
});

describe('planWaitingSince: desde cuándo espera un planeado', () => {
  it('la primera entrada en el Plan manda; sin ella, el alta', () => {
    assert.equal(planWaitingSince(T12, null), T12);
    assert.equal(planWaitingSince(T12, T10), T10);
    // La subconsulta cruda puede volver como texto según el driver.
    assert.equal(planWaitingSince(T12, String(T10)), T10);
  });
});
