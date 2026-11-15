import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { rawRow, T0 } from '../../../__tests__/helpers';
import {
  at,
  hours,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getSessionWindows, placeUnlock } from '../placement';

// A igual arranque, el desbloqueo cae en la sesión creada DESPUÉS, y eso lo
// dice `syncCreated`, no el id (§10.7, F-09). Datos inventados.

let fx: QueryFixture;
afterEach(() => fx.close());

describe('placeUnlock con dos sesiones que arrancan a la vez', () => {
  it('gana la de syncCreated mayor aunque su id sea menor', () => {
    fx = openQueryDb();
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    // Dos PCs offline: la segunda se creó después (reloj) pero con el reloj de
    // pared atrasado, así que su id es menor.
    fx.wall.set(T0 + hours(48));
    const older = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: at(hours(2)) });
    fx.wall.set(T0);
    const newer = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: at(hours(2)) });
    assert.ok(newer < older, 'precondición: el id de `newer` es menor');
    const clock = (id: string): string => String(rawRow(fx.local, 'sessions', id)?.syncCreated);
    assert.ok(clock(older) < clock(newer), 'precondición: su reloj es mayor');

    const windows = getSessionWindows(fx.ctx, gameId);
    assert.deepEqual(
      windows.map((window) => window.sessionId),
      [older, newer],
    );
    const placed = placeUnlock(at(hours(1)), windows, fx.ctx.now());
    assert.equal(placed.sessionId, newer);
    assert.equal(placed.playthroughId, playthroughId);
  });
});
