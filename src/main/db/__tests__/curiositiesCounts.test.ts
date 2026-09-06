import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import { cleanupDbs, freshDb, makeGame, measure, type TestDb } from './harness';

let db: TestDb;
let getCuriositiesCounts: typeof import('../queries/curiosities/getPendingCuriositiesGames').getCuriositiesCounts;
let getPendingCuriositiesGames: typeof import('../queries/curiosities/getPendingCuriositiesGames').getPendingCuriositiesGames;
before(async () => {
  ({ getCuriositiesCounts, getPendingCuriositiesGames } =
    await import('../queries/curiosities/getPendingCuriositiesGames'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(cleanupDbs);

it('counts both totals in one query, excluding planned games from both populations', async () => {
  await makeGame(db, { curiositiesGeneratedAt: new Date(0) });
  const pendingId = await makeGame(db);
  await makeGame(db, { planned: true, curiositiesGeneratedAt: new Date() });
  await makeGame(db, { planned: true });
  const [counts, work] = await measure(getCuriositiesCounts);
  assert.deepEqual(counts, { totalGames: 2, generatedGames: 1 });
  assert.deepEqual(work, { queries: 1, rows: 1 });
  assert.deepEqual(
    (await getPendingCuriositiesGames()).map((game) => game.id),
    [pendingId],
  );
});

it('an empty library returns numeric zeros even with generated planned games', async () => {
  assert.deepEqual(await getCuriositiesCounts(), { totalGames: 0, generatedGames: 0 });
  await makeGame(db, { planned: true, curiositiesGeneratedAt: new Date() });
  assert.deepEqual(await getCuriositiesCounts(), { totalGames: 0, generatedGames: 0 });
});
