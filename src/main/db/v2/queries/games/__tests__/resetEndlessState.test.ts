import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, rawRow } from '../../../__tests__/helpers';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { resetEndlessState } from '../resetEndlessState';

// games:resetEndlessState en 2.0. Referencia 1.x: `resetEndlessState.test.ts`.
// Sin `plan_to_play` que exceptuar: el historial del Plan vive en
// `plan_entries` y no se toca.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const liveEventTypes = (playthroughId: string): string[] =>
  (
    fx.local.db.$client
      .prepare(
        'SELECT type FROM state_events WHERE playthroughId = ? AND syncDeleted IS NULL ORDER BY syncCreated',
      )
      .all(playthroughId) as { type: string }[]
  ).map((row) => row.type);

describe('resetEndlessState', () => {
  it('lápida a todo el log, en TODOS los playthroughs; sesiones, horas manuales y Plan se conservan', () => {
    const gameId = seedGame(fx.ctx, { title: 'Se hace endless', planned: { note: 'porqué' } });
    const first = seedPlaythrough(fx.ctx, { gameId, manualHours: 10 });
    seedStateEvent(fx.ctx, { playthroughId: first, type: 'started' });
    seedStateEvent(fx.ctx, { playthroughId: first, type: 'completed' });
    const s1 = seedSession(fx.ctx, { playthroughId: first });
    const second = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId: second, type: 'on_hold' });
    const s2 = seedSession(fx.ctx, { playthroughId: second });

    assert.equal(resetEndlessState(fx.ctx, gameId), true);

    assert.deepEqual(liveEventTypes(first), []);
    assert.deepEqual(liveEventTypes(second), []);
    assert.equal(rawRow(fx.local, 'sessions', s1)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'sessions', s2)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'playthroughs', first)?.manualHours, 10);
    assert.equal(rawRow(fx.local, 'plan_entries', gameId)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'plan_entries', gameId)?.note, 'porqué');
    // Lápidas, no borrados físicos: viajan por sync.
    assert.equal(count(fx.local, 'state_events'), 3);
  });

  it('un juego sin playthroughs, o que no existe, no revienta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Recién añadido' });
    assert.equal(resetEndlessState(fx.ctx, gameId), true);
    assert.equal(resetEndlessState(fx.ctx, 'no-existe'), true);
  });

  it('no toca el log de otro juego', () => {
    const gameId = seedGame(fx.ctx, { title: 'Se hace endless' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId: pt, type: 'completed' });
    const neighbour = seedGame(fx.ctx, { title: 'Vecino' });
    const npt = seedPlaythrough(fx.ctx, { gameId: neighbour });
    seedStateEvent(fx.ctx, { playthroughId: npt, type: 'started' });
    seedStateEvent(fx.ctx, { playthroughId: npt, type: 'completed' });

    resetEndlessState(fx.ctx, gameId);
    assert.deepEqual(liveEventTypes(npt), ['started', 'completed']);
  });

  it('los eventos de un playthrough ya borrado no se vuelven a tocar', () => {
    const gameId = seedGame(fx.ctx, { title: 'Con borrado' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const event = seedStateEvent(fx.ctx, { playthroughId: pt });
    fx.ctx.store.remove('playthroughs', pt);
    const before = rawRow(fx.local, 'state_events', event)?.syncUpdated;
    resetEndlessState(fx.ctx, gameId);
    assert.equal(rawRow(fx.local, 'state_events', event)?.syncUpdated, before);
  });
});
