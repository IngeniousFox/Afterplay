import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { sessionsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeOpenSession,
  makeSession,
  makeStateEvent,
  measure,
  type TestDb,
} from './harness';

let db: TestDb;
let getGames: typeof import('../queries/games/getGames').getGames;
let getGameById: typeof import('../queries/games/getGameById').getGameById;
before(async () => {
  ({ getGames } = await import('../queries/games/getGames'));
  ({ getGameById } = await import('../queries/games/getGameById'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(cleanupDbs);

it('an empty library stops after reading games, including when only planned history exists', async () => {
  const gameId = await makeGame(db, { planned: true });
  const iterationId = await makeIteration(db, gameId);
  await makeSession(db, iterationId, '2024-01-01T12:00:00Z', 3);
  const [games, work] = await measure(getGames);
  assert.deepEqual(games, []);
  assert.deepEqual(work, { queries: 1, rows: 0 });
});

it('empty playthroughs retain manual hours without acquiring a phantom or live session', async () => {
  const gameId = await makeGame(db);
  const empty = await makeIteration(db, gameId, { manualTotalPlayed: 4.5 });
  await makeStateEvent(db, empty, 'completed', '2023-12-01T12:00:00Z');
  const [game] = await getGames();
  assert.equal(game.totalHours, 4.5);
  assert.equal(game.sessionCount, 0);
  assert.equal(game.isLive, false);
  assert.equal(game.liveSince, null);
  assert.deepEqual(game.manualIterations, [{ iterationId: empty, hours: 4.5, year: 2023 }]);
  assert.equal(game.lastPlayedAt?.toISOString(), '2023-12-01T12:00:00.000Z');
});

it('growing session history keeps the same query and transfer budget with identical detail totals', async () => {
  const gameId = await makeGame(db);
  const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 12.5 });
  await makeStateEvent(db, iterationId, 'started', '2024-01-01T12:00:00Z');
  await makeSession(db, iterationId, '2024-01-01T12:00:00Z', 1, { isManual: true });
  const [, initialWork] = await measure(getGames);
  for (let batch = 0; batch < 5; batch++) {
    await db.insert(sessionsTable).values(
      Array.from({ length: 100 }, (_, index) => ({
        iterationId,
        isManual: false,
        startedAt: new Date(1704110400000 + (batch * 100 + index) * 3600000),
        endedAt: new Date(1704110400000 + (batch * 100 + index) * 3600000 + 1800000),
        durationSec: 1800,
        datePrecision: 'datetime' as const,
      })),
    );
  }
  await makeOpenSession(db, iterationId, '2025-01-01T12:00:00Z');
  const [[game], grownWork] = await measure(getGames);
  const detail = await getGameById(gameId);
  assert.deepEqual(grownWork, initialWork);
  assert.deepEqual(grownWork, { queries: 3, rows: 3 });
  assert.equal(game.sessionCount, 502);
  assert.equal(game.totalHours, 263.5);
  assert.equal(game.totalHours, detail?.totalHours);
  assert.equal(game.isLive, true);
  assert.equal(game.liveSince?.toISOString(), '2025-01-01T12:00:00.000Z');
});

it('the real index migration preserves populated sessions and SQLite uses it for a playthrough', async () => {
  const gameId = await makeGame(db);
  const iterationId = await makeIteration(db, gameId);
  await makeSession(db, iterationId, '2024-01-01T12:00:00Z', 2, { note: 'Keep my session note' });
  await makeOpenSession(db, iterationId, '2025-01-01T12:00:00Z');
  // Only the disposable migrated fixture is changed. Reapply the new DDL
  // over populated tables, so it also exercises an existing library upgrade.
  await db.run(sql`DROP INDEX sessions_iteration_idx`);
  const beforeRows = await db.all(sql`SELECT * FROM sessions ORDER BY id`);
  const beforeFks = await db.all(sql`PRAGMA foreign_key_list(sessions)`);
  const migration = readFileSync(
    'drizzle/20260906080212_sessions_iteration_index/migration.sql',
    'utf8',
  );
  await db.run(sql.raw(migration));
  assert.deepEqual(await db.all(sql`SELECT * FROM sessions ORDER BY id`), beforeRows);
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_list(sessions)`), beforeFks);
  const plan = await db.all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE iterationId = ${iterationId}`,
  );
  assert.ok(
    plan.some((row) => row.detail.includes('USING INDEX sessions_iteration_idx')),
    JSON.stringify(plan),
  );
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
});
