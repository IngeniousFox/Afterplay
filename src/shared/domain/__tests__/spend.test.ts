import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  costPerHourOf,
  playthroughClosedAt,
  splitSpendByPlaythrough,
  totalSpendOf,
  type SpendRow,
  type SpendStateEvent,
} from '../spend';

// El reparto del gasto entre playthroughs, en el único sitio donde está
// escrito. Los escenarios son los de la "paridad" de la ficha
// (worker/src/queries/__tests__/gameDetailParity.test.ts y
// src/main/db/__tests__/getGameById.test.ts), que comparaban dos copias; aquí
// se prueba la regla que ahora usan las dos fichas.

let nextId = 1;
const event = (type: SpendStateEvent['type'], occurredAt: string): SpendStateEvent => ({
  id: String(nextId++).padStart(4, '0'),
  type,
  occurredAt: new Date(occurredAt),
});
const spend = (occurredAt: string, amount: number): SpendRow => ({
  amount,
  occurredAt: new Date(occurredAt),
});

describe('cuándo se cierra un playthrough (playthroughClosedAt)', () => {
  it('lo cierra el completed aunque detrás venga el plan_to_play del alta', () => {
    const closed = playthroughClosedAt([
      event('started', '2023-05-01T00:00:00Z'),
      event('completed', '2023-06-01T00:00:00Z'),
      event('plan_to_play', '2026-08-13T10:00:00Z'),
    ]);
    assert.equal(closed?.toISOString(), '2023-06-01T00:00:00.000Z');
  });

  it('on_hold y resting son pausas: no cierran', () => {
    assert.equal(playthroughClosedAt([event('on_hold', '2024-01-01T00:00:00Z')]), null);
    assert.equal(playthroughClosedAt([event('resting', '2024-01-01T00:00:00Z')]), null);
  });

  it('uno reabierto después de un dropped vuelve a estar abierto', () => {
    assert.equal(
      playthroughClosedAt([
        event('dropped', '2024-01-01T00:00:00Z'),
        event('started', '2024-02-01T00:00:00Z'),
      ]),
      null,
    );
  });
});

describe('el reparto del gasto (splitSpendByPlaythrough)', () => {
  it('el DLC de años después va al playthrough que estaba abierto, no al que tenía un plan_to_play', () => {
    const events = new Map([
      [
        '1',
        [
          event('started', '2023-05-01T00:00:00Z'),
          event('completed', '2023-06-01T00:00:00Z'),
          event('plan_to_play', '2026-08-13T10:00:00Z'),
        ],
      ],
      ['2', [event('started', '2026-07-01T00:00:00Z')]],
    ]);
    const split = splitSpendByPlaythrough([{ id: '1' }, { id: '2' }], events, [
      spend('2023-04-20T00:00:00Z', 60),
      spend('2026-07-05T00:00:00Z', 25),
    ]);
    assert.deepEqual(
      [...split],
      [
        ['1', 60],
        ['2', 25],
      ],
    );
  });

  it('un gasto en el instante exacto del cierre se queda en el playthrough que cerraba', () => {
    const events = new Map([
      ['1', [event('completed', '2026-03-01T00:00:00Z')]],
      ['2', [event('started', '2026-09-01T00:00:00Z')]],
    ]);
    const split = splitSpendByPlaythrough([{ id: '1' }, { id: '2' }], events, [
      spend('2026-03-01T00:00:00Z', 20),
    ]);
    assert.equal(split.get('1'), 20);
    assert.equal(split.get('2'), undefined);
  });

  it('un milisegundo después del cierre ya es del siguiente', () => {
    const events = new Map([
      ['1', [event('completed', '2026-03-01T00:00:00Z')]],
      ['2', [event('started', '2026-09-01T00:00:00Z')]],
    ]);
    const split = splitSpendByPlaythrough([{ id: '1' }, { id: '2' }], events, [
      spend('2026-03-01T00:00:00.001Z', 20),
    ]);
    assert.equal(split.get('1'), undefined);
    assert.equal(split.get('2'), 20);
  });

  it('lo comprado antes de arrancar cae en el primero, y lo posterior al último cierre en el último', () => {
    const events = new Map([
      ['1', [event('completed', '2020-01-01T00:00:00Z')]],
      ['2', [event('dropped', '2021-01-01T00:00:00Z')]],
    ]);
    const split = splitSpendByPlaythrough([{ id: '1' }, { id: '2' }], events, [
      spend('2019-01-01T00:00:00Z', 10),
      spend('2025-01-01T00:00:00Z', 5),
    ]);
    assert.equal(split.get('1'), 10);
    assert.equal(split.get('2'), 5);
  });

  it('no depende del orden en que lleguen los playthroughs', () => {
    const events = new Map([['1', [event('completed', '2026-03-01T00:00:00Z')]]]);
    const split = splitSpendByPlaythrough([{ id: '2' }, { id: '1' }], events, [
      spend('2026-01-01T00:00:00Z', 7),
    ]);
    assert.equal(split.get('1'), 7);
  });

  it('sin playthroughs no hay a quién atribuir nada, pero el total sigue contando', () => {
    const spends = [spend('2026-01-01T00:00:00Z', 7), spend('2026-02-01T00:00:00Z', 3)];
    assert.equal(splitSpendByPlaythrough([], new Map(), spends).size, 0);
    assert.equal(totalSpendOf(spends), 10);
  });
});

describe('el coste por hora', () => {
  it('sin horas es null, nunca Infinity', () => {
    assert.equal(costPerHourOf(60, 0), null);
    assert.equal(costPerHourOf(60, 30), 2);
  });
});
