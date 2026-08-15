import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { cleanupDbs, freshDb, makeGame, makeIteration, makeSession, type TestDb } from './harness';

let db: TestDb;
let getGames: typeof import('../queries/games/getGames').getGames;

before(async () => {
  ({ getGames } = await import('../queries/games/getGames'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

describe('andamio', () => {
  it('cada test arranca con la base vacia', async () => {
    assert.deepEqual(await getGames(), []);
  });

  it('las consultas reales leen de la base del andamio', async () => {
    const gameId = await makeGame(db, { title: 'Celeste' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-02T10:00:00Z', 2);
    const games = await getGames();
    assert.equal(games.length, 1);
    assert.equal(games[0].totalHours, 2);
    assert.equal(games[0].sessionCount, 1);
  });
});
