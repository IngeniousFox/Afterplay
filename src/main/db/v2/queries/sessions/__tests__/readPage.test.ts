import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  at,
  hours,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { countAllSessions, getAllSessions } from '../read';

// Las sesiones por páginas (la lista de la PWA): las páginas encajan con la
// lista entera y el total cuenta lo mismo que ella.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getAllSessions paginada', () => {
  it('las páginas, una detrás de otra, son la lista entera en su orden', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    for (let i = 0; i < 5; i++) {
      seedSession(fx.ctx, { playthroughId, startedAt: at(hours(i * 2)) });
    }
    const all = getAllSessions(fx.ctx);
    const paged = [
      ...getAllSessions(fx.ctx, { limit: 2, offset: 0 }),
      ...getAllSessions(fx.ctx, { limit: 2, offset: 2 }),
      ...getAllSessions(fx.ctx, { limit: 2, offset: 4 }),
    ];
    assert.equal(all.length, 5);
    assert.deepEqual(
      paged.map((row) => row.id),
      all.map((row) => row.id),
    );
    assert.deepEqual(getAllSessions(fx.ctx, { limit: 2, offset: 10 }), []);
  });

  it('el total cuenta las vivas asignadas y no las de un juego borrado', () => {
    const kept = seedGame(fx.ctx, { title: 'Celeste' });
    const gone = seedGame(fx.ctx, { title: 'Hades' });
    const p1 = seedPlaythrough(fx.ctx, { gameId: kept });
    const p2 = seedPlaythrough(fx.ctx, { gameId: gone });
    seedSession(fx.ctx, { playthroughId: p1, startedAt: at(0) });
    seedSession(fx.ctx, { playthroughId: p2, startedAt: at(hours(3)) });
    assert.equal(countAllSessions(fx.ctx), 2);
    tombstoneOnly(fx.ctx, 'games', gone);
    assert.equal(countAllSessions(fx.ctx), 1);
    assert.equal(getAllSessions(fx.ctx).length, 1);
  });
});
