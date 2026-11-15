import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getStatsSummary } from '../statsSummary';
import { event, openSession, session } from './helpers';

// El resumen de la portada sobre las consultas del escritorio. La regla del año
// está en shared/domain/__tests__/statsSummary.test.ts; aquí, que las filas
// que se le traen son las que son.

let fx: QueryFixture;
beforeEach(() => {
  // El reloj de la puerta arranca el 2025-11-13.
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getStatsSummary', () => {
  it('una biblioteca vacía da todo a cero', () => {
    const summary = getStatsSummary(fx.ctx);
    assert.equal(summary.totalGames, 0);
    assert.equal(summary.hoursThisYear, 0);
    assert.equal(summary.year, 2025);
    assert.equal(summary.live, null);
  });

  it('suma horas y sesiones, separa el año y deja fuera el Plan', () => {
    const celeste = seedGame(fx.ctx, { title: 'Celeste' });
    const p1 = seedPlaythrough(fx.ctx, { gameId: celeste });
    session(fx.ctx, p1, '2025-03-01T12:00:00Z', 2);
    session(fx.ctx, p1, '2024-03-01T12:00:00Z', 5);
    event(fx.ctx, p1, 'completed', '2025-03-02T00:00:00Z');
    const hades = seedGame(fx.ctx, { title: 'Hades' });
    const p2 = seedPlaythrough(fx.ctx, { gameId: hades });
    openSession(fx.ctx, p2, '2025-11-13T10:00:00Z');
    seedGame(fx.ctx, { title: 'Silksong', planned: true });

    const summary = getStatsSummary(fx.ctx);

    assert.equal(summary.totalGames, 2);
    assert.equal(summary.totalSessions, 3);
    assert.equal(summary.totalHours, 7);
    assert.equal(summary.hoursThisYear, 2);
    assert.equal(summary.gamesThisYear, 1);
    assert.equal(summary.beaten, 1);
    assert.equal(summary.playing, 0);
    assert.equal(summary.unplayed, 1);
    assert.equal(summary.live?.gameId, hades);
    assert.equal(summary.live?.since, Date.parse('2025-11-13T10:00:00Z'));
  });
});
