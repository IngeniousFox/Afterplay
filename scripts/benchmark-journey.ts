import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEntries, groupEntriesByYearMonth } from '../src/renderer/src/lib/journeyEntries';
import { syntheticJourney } from '../src/renderer/src/lib/__tests__/journeyFixtures';

// npx tsx scripts/benchmark-journey.ts [ruta al journeyEntries.ts anterior]
// Solo objetos sintéticos en memoria; ninguna base de datos ni servicios.
const run = async (): Promise<void> => {
  const baselinePath = process.argv[2];
  const baseline = baselinePath
    ? ((await import(pathToFileURL(resolve(baselinePath)).href)) as {
        buildEntries: typeof buildEntries;
        groupEntriesByYearMonth: typeof groupEntriesByYearMonth;
      })
    : null;
  const measure = (fn: () => void): number => {
    for (let i = 0; i < 4; i++) fn();
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      fn();
      samples.push(performance.now() - start);
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  };

  for (const [gameCount, sessionsPerGame] of [
    [120, 60],
    [600, 150],
  ]) {
    const { games, sessions, events } = syntheticJourney(gameCount, sessionsPerGame);
    const entries = buildEntries(games, sessions, events);
    const now = new Date(2026, 0, 1);
    if (baseline) {
      assert.deepEqual(entries, baseline.buildEntries(games, sessions, events));
      assert.deepEqual(
        groupEntriesByYearMonth(entries, now),
        baseline.groupEntriesByYearMonth(entries, now),
      );
    }
    const beforeMs = baseline
      ? measure(() => {
          baseline.buildEntries(games, sessions, events);
        })
      : null;
    const afterMs = measure(() => {
      buildEntries(games, sessions, events);
    });
    console.log(
      JSON.stringify({
        games: gameCount,
        sessions: sessions.length,
        entries: entries.length,
        beforeMs,
        afterMs,
        speedup: beforeMs === null ? null : beforeMs / afterMs,
        parity: baseline ? 'passed' : 'not compared',
      }),
    );
  }
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
