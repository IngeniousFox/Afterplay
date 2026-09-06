import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../src/main/db/schema';
import { cleanupDbs, freshDb, measure } from '../src/main/db/__tests__/harness';

// Opt-in comparison against a saved pre-refactor getGames.ts. It only opens
// the harness's synthetic, disposable DB, never Electron's user data or the
// default drizzle config. PowerShell, from the repository root:
//   $env:AFTERPLAY_DB_BASELINE = 'C:\path\to\saved\getGames.ts'
//   npx tsx --test --experimental-test-module-mocks scripts/benchmark-db.ts
// The temporary module lives beside getGames so its original relative
// imports resolve. A unique name and exclusive create protect existing files.
let comparisonModule: string | null = null;
let baseline: typeof import('../src/main/db/queries/games/getGames').getGames;
let candidate: typeof import('../src/main/db/queries/games/getGames').getGames;
let detail: typeof import('../src/main/db/queries/games/getGameById').getGameById;
before(async () => {
  const baselinePath = process.env.AFTERPLAY_DB_BASELINE;
  assert.ok(baselinePath, 'Set AFTERPLAY_DB_BASELINE to the saved pre-refactor getGames.ts');
  const modulePath = fileURLToPath(
    new URL(`../src/main/db/queries/games/.getGames-benchmark-${process.pid}.ts`, import.meta.url),
  );
  writeFileSync(modulePath, readFileSync(baselinePath, 'utf8'), { flag: 'wx' });
  comparisonModule = modulePath;
  ({ getGames: baseline } = await import(pathToFileURL(modulePath).href));
  ({ getGames: candidate } = await import('../src/main/db/queries/games/getGames'));
  ({ getGameById: detail } = await import('../src/main/db/queries/games/getGameById'));
});
after(() => {
  cleanupDbs();
  if (comparisonModule) rmSync(comparisonModule);
});

it('synthetic benchmark', async () => {
  const db = await freshDb();
  for (let offset = 0; offset < 600; offset += 50) {
    await db.insert(gamesTable).values(
      Array.from({ length: 50 }, (_, index) => ({
        id: offset + index + 1,
        title: `Game ${offset + index + 1}`,
        planned: offset + index >= 300,
      })),
    );
  }
  for (let offset = 0; offset < 1800; offset += 50) {
    await db.insert(iterationsTable).values(
      Array.from({ length: 50 }, (_, index) => ({
        id: offset + index + 1,
        gameId: Math.floor((offset + index) / 3) + 1,
        manualTotalPlayed: 12.5,
        label: `Playthrough ${offset + index + 1}`,
        playedPlatform: 'PC',
        origin: 'steam' as const,
      })),
    );
    await db.insert(stateEventsTable).values(
      Array.from({ length: 50 }, (_, index) => ({
        iterationId: offset + index + 1,
        type: 'started' as const,
        occurredAt: new Date('2024-01-01T12:00:00Z'),
        datePrecision: 'datetime' as const,
      })),
    );
  }
  for (let offset = 0; offset < 18000; offset += 50) {
    await db.insert(sessionsTable).values(
      Array.from({ length: 50 }, (_, index) => ({
        iterationId: ((offset + index) % 900) + 1,
        isManual: false,
        startedAt: new Date(1704110400000 + (offset + index) * 3600000),
        endedAt: new Date(1704110400000 + (offset + index) * 3600000 + 1800000),
        durationSec: 1800,
        datePrecision: 'datetime' as const,
      })),
    );
  }
  await db.run(sql`DROP INDEX sessions_iteration_idx`);
  const [oldValue, oldStats] = await measure(baseline);
  await db.run(sql`CREATE INDEX sessions_iteration_idx ON sessions (iterationId)`);
  const [newValue, newStats] = await measure(candidate);
  assert.deepEqual(newValue, oldValue);
  const oldTimes: number[] = [],
    newTimes: number[] = [];
  const oldDetailTimes: number[] = [],
    newDetailTimes: number[] = [];
  for (let i = 0; i < 15; i++) {
    for (const [fn, times] of i % 2
      ? ([
          [candidate, newTimes],
          [baseline, oldTimes],
        ] as const)
      : ([
          [baseline, oldTimes],
          [candidate, newTimes],
        ] as const)) {
      await db.run(sql`DROP INDEX IF EXISTS sessions_iteration_idx`);
      if (fn === candidate)
        await db.run(sql`CREATE INDEX sessions_iteration_idx ON sessions (iterationId)`);
      const start = performance.now();
      await fn();
      times.push(performance.now() - start);
      const detailStart = performance.now();
      await detail(101);
      (fn === candidate ? newDetailTimes : oldDetailTimes).push(performance.now() - detailStart);
    }
  }
  console.log(
    JSON.stringify({
      oldStats,
      newStats,
      oldMedian: oldTimes.sort((a, b) => a - b)[7],
      newMedian: newTimes.sort((a, b) => a - b)[7],
      oldDetailMedian: oldDetailTimes.sort((a, b) => a - b)[7],
      newDetailMedian: newDetailTimes.sort((a, b) => a - b)[7],
    }),
  );
});
