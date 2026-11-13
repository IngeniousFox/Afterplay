import assert from 'node:assert/strict';
import { before, afterEach, beforeEach, describe, it } from 'node:test';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { isStoreError } from '../../../store';
import type { SpendEventSummary } from '../../../../../../shared/types';
import {
  T0,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSpendEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { deleteIteration } from '../playthroughs';
import { DEFAULT_CURRENCY } from '../../common/currency';
import { addSpendEvent, deleteSpendEvent, getAllSpendEvents, updateSpendEvent } from '../spend';

// Los gastos sobre el esquema 2.0. La 1.x no tenía tests propios de
// add/update/delete; de `yearTotals.test.ts` se porta la parte que depende de
// esta consulta: la forma de `getAllSpendEvents` alimentando el total del año.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const UNKNOWN_ID = '0194c2f0-0000-7000-8000-000000000000';

// La firma de yearTotals escrita a mano y el import dinámico con la ruta en una
// constante, por el mismo motivo que en src/main/db/__tests__/yearTotals.test.ts:
// un import estático metería el renderer (y su alias '@/lib/utils') en el
// programa de tsconfig.node.json.
type YearTotals = (
  games: [],
  sessions: [],
  spendEvents: SpendEventSummary<string>[],
  year: number | 'all',
) => { totalSpent: number; costPerHour: number | null };
const STATS_TOTALS = '../../../../../../renderer/src/lib/statsTotals';
let yearTotals: YearTotals;
before(async () => {
  ({ yearTotals } = (await import(STATS_TOTALS)) as { yearTotals: YearTotals });
});

describe('addSpendEvent', () => {
  it('crea el gasto con la moneda única y lo devuelve releído', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const gasto = addSpendEvent(fx.ctx, {
      gameId,
      type: 'purchase',
      amount: 19.99,
      occurredAt: new Date('2025-12-22T00:00:00Z'),
      datePrecision: 'day',
      note: 'Rebajas',
    });

    assert.deepEqual(
      { ...gasto, id: undefined },
      {
        id: undefined,
        gameId,
        type: 'purchase',
        amount: 19.99,
        occurredAt: new Date('2025-12-22T00:00:00Z'),
        datePrecision: 'day',
        note: 'Rebajas',
      },
    );
    const raw = rawRow(fx.local, 'spend_events', gasto.id);
    assert.equal(raw?.currency, DEFAULT_CURRENCY);
    assert.equal(DEFAULT_CURRENCY, 'EUR');
    assert.equal(raw?.playthroughId, null);
  });

  it('sin occurredAt, la fecha es "ahora" del reloj, explícita', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    fx.wall.advance(777);
    const gasto = addSpendEvent(fx.ctx, {
      gameId,
      type: 'ingame_spend',
      amount: 5,
      datePrecision: 'datetime',
    });
    assert.equal(gasto.occurredAt.getTime(), T0 + 777);
    assert.equal(gasto.note, null);
  });

  it('playthroughId opcional: si viene, tiene que ser un playthrough vivo del mismo juego', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const otroJuego = seedGame(fx.ctx, { title: 'Otro' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const ajeno = seedPlaythrough(fx.ctx, { gameId: otroJuego });
    const borrado = seedPlaythrough(fx.ctx, { gameId });
    fx.ctx.store.remove('playthroughs', borrado);
    const base = { gameId, type: 'purchase' as const, amount: 1, datePrecision: 'day' as const };

    const ok = addSpendEvent(fx.ctx, { ...base, playthroughId: pt });
    assert.equal(rawRow(fx.local, 'spend_events', ok.id)?.playthroughId, pt);

    const antes = count(fx.local, 'spend_events');
    assert.throws(
      () => addSpendEvent(fx.ctx, { ...base, playthroughId: ajeno }),
      (e: unknown) => isStoreError(e, 'invalid_value'),
    );
    assert.throws(
      () => addSpendEvent(fx.ctx, { ...base, playthroughId: borrado }),
      (e: unknown) => isStoreError(e, 'deleted'),
    );
    assert.throws(
      () => addSpendEvent(fx.ctx, { ...base, playthroughId: UNKNOWN_ID }),
      (e: unknown) => isStoreError(e, 'not_found'),
    );
    assert.equal(count(fx.local, 'spend_events'), antes);
  });

  it('juego inexistente → not_found; borrado → deleted', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    fx.ctx.store.remove('games', gameId);
    const base = { type: 'purchase' as const, amount: 1, datePrecision: 'day' as const };
    assert.throws(
      () => addSpendEvent(fx.ctx, { ...base, gameId: UNKNOWN_ID }),
      (e: unknown) => isStoreError(e, 'not_found'),
    );
    assert.throws(
      () => addSpendEvent(fx.ctx, { ...base, gameId }),
      (e: unknown) => isStoreError(e, 'deleted'),
    );
  });
});

describe('updateSpendEvent', () => {
  it('corrige cantidad, fecha, precisión y nota; el tipo no se toca', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const id = seedSpendEvent(fx.ctx, { gameId });
    const row = updateSpendEvent(fx.ctx, id, {
      amount: 25,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      datePrecision: 'month',
      note: 'DLC',
    });
    assert.equal(row?.amount, 25);
    assert.equal(row?.datePrecision, 'month');
    assert.equal(row?.note, 'DLC');
    assert.equal(row?.type, 'purchase');
  });

  it('patch vacío o sin cambios: no escribe (F-33) y devuelve el gasto', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const id = seedSpendEvent(fx.ctx, { gameId, amount: 10 });
    markClean(fx.local, 'spend_events');
    assert.equal(updateSpendEvent(fx.ctx, id, {})?.id, id);
    assert.equal(updateSpendEvent(fx.ctx, id, { amount: 10 })?.amount, 10);
    assert.equal(count(fx.local, 'spend_events', 'syncDirty = 1'), 0);
  });

  it('null si no existe, si está borrado o si su juego está borrado (F-11)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const borrado = seedSpendEvent(fx.ctx, { gameId });
    const huerfano = seedSpendEvent(fx.ctx, { gameId });
    deleteSpendEvent(fx.ctx, borrado);
    assert.equal(updateSpendEvent(fx.ctx, UNKNOWN_ID, { amount: 1 }), null);
    assert.equal(updateSpendEvent(fx.ctx, borrado, { amount: 1 }), null);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(updateSpendEvent(fx.ctx, huerfano, { amount: 1 }), null);
    assert.equal(rawRow(fx.local, 'spend_events', huerfano)?.amount, 10);
  });
});

describe('deleteSpendEvent', () => {
  it('lápida (no DELETE); false si no existe, si ya estaba borrado o con el juego borrado', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const id = seedSpendEvent(fx.ctx, { gameId });
    const huerfano = seedSpendEvent(fx.ctx, { gameId });

    assert.equal(deleteSpendEvent(fx.ctx, id), true);
    assert.notEqual(rawRow(fx.local, 'spend_events', id)?.syncDeleted, null);
    assert.equal(deleteSpendEvent(fx.ctx, id), false);
    assert.equal(deleteSpendEvent(fx.ctx, UNKNOWN_ID), false);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(deleteSpendEvent(fx.ctx, huerfano), false);
  });
});

describe('getAllSpendEvents', () => {
  it('gastos vivos con juego vivo, con la forma {gameId, amount, occurredAt}', () => {
    const tunic = seedGame(fx.ctx, { title: 'Tunic' });
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    seedSpendEvent(fx.ctx, {
      gameId: tunic,
      amount: 20,
      occurredAt: new Date('2025-12-22T12:00:00Z'),
    });
    const quitado = seedSpendEvent(fx.ctx, { gameId: tunic, amount: 99 });
    deleteSpendEvent(fx.ctx, quitado);
    seedSpendEvent(fx.ctx, { gameId: borrado, amount: 50 });
    tombstoneOnly(fx.ctx, 'games', borrado);

    assert.deepEqual(getAllSpendEvents(fx.ctx), [
      { gameId: tunic, amount: 20, occurredAt: new Date('2025-12-22T12:00:00Z') },
    ]);
  });

  it('borrar el playthrough al que apuntaba no oculta el gasto (nullify, no cascada)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    seedSpendEvent(fx.ctx, { gameId, playthroughId: pt, amount: 15 });
    deleteIteration(fx.ctx, pt);
    assert.deepEqual(
      getAllSpendEvents(fx.ctx).map((s) => s.amount),
      [15],
    );
  });

  it('(yearTotals) el gasto se filtra por SU fecha: cuenta en el año en que salió de la cartera', () => {
    const tunic = seedGame(fx.ctx, { title: 'Tunic' });
    addSpendEvent(fx.ctx, {
      gameId: tunic,
      type: 'purchase',
      amount: 20,
      occurredAt: new Date('2025-12-22T12:00:00Z'),
      datePrecision: 'day',
    });
    const gastos = getAllSpendEvents(fx.ctx);
    assert.equal(yearTotals([], [], gastos, 2026).totalSpent, 0);
    assert.equal(yearTotals([], [], gastos, 2025).totalSpent, 20);
  });

  it('(yearTotals) un año con gasto y sin horas no tiene coste por hora: null', () => {
    const comprado = seedGame(fx.ctx, { title: 'Cyberpunk 2077' });
    addSpendEvent(fx.ctx, {
      gameId: comprado,
      type: 'purchase',
      amount: 60,
      occurredAt: new Date('2025-11-20T12:00:00Z'),
      datePrecision: 'day',
    });
    const cifras = yearTotals([], [], getAllSpendEvents(fx.ctx), 2025);
    assert.equal(cifras.totalSpent, 60);
    assert.equal(cifras.costPerHour, null);
  });
});
