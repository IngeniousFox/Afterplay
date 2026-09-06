// Synthetic input only. Compare against an untouched source snapshot:
// npx tsx scripts/benchmark-shared.ts <baseline-directory>
// No databases, credentials, network requests or application data are read.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import * as achievements from '../src/shared/achievements';
import * as format from '../src/shared/format';
import * as release from '../src/shared/releaseDate';
import * as groups from '../src/shared/sessionGroups';

const median = (values: number[]): number =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

const main = async (): Promise<void> => {
  const baselineDirectory = process.argv[2];
  if (!baselineDirectory) {
    throw new Error('Usage: npx tsx scripts/benchmark-shared.ts <baseline-directory>');
  }
  const source = (name: string): string =>
    pathToFileURL(resolve(baselineDirectory, `src/renderer/src/lib/${name}.ts`)).href;
  const [oldGroups, oldFormat, oldRelease, oldAchievements] = (await Promise.all([
    import(source('sessionGroups')),
    import(source('format')),
    import(source('releaseDate')),
    import(source('achievements')),
  ])) as [
    typeof import('../src/renderer/src/lib/sessionGroups'),
    typeof import('../src/renderer/src/lib/format'),
    typeof import('../src/renderer/src/lib/releaseDate'),
    typeof import('../src/renderer/src/lib/achievements'),
  ];

  let seed = 382912;
  const random = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const now = new Date(2026, 8, 6, 14, 30);
  const dates = Array.from(
    { length: 500 },
    () =>
      new Date(
        1960 + Math.floor(random() * 141),
        Math.floor(random() * 12),
        1 + Math.floor(random() * 28),
        Math.floor(random() * 24),
        Math.floor(random() * 60),
      ),
  );
  let assertions = 0;
  const equal = (actual: unknown, expected: unknown): void => {
    assert.deepEqual(actual, expected);
    assertions++;
  };

  for (const date of dates) {
    const value = random() * 2000000 - 500;
    for (const name of [
      'formatHours',
      'formatCount',
      'formatBytes',
      'formatMoney',
      'formatElapsed',
    ] as const) {
      equal(format[name](value), oldFormat[name](value));
    }
    for (const precision of ['day', 'month', 'year', 'datetime'] as const) {
      for (const time of ['12h', '24h'] as const) {
        equal(
          format.formatByPrecision(date, precision, time),
          oldFormat.formatByPrecision(date, precision, time),
        );
      }
      if (precision !== 'datetime') {
        const game = {
          releaseDate: date,
          releaseDatePrecision: precision,
          releaseYear: date.getFullYear(),
        };
        equal(release.formatRelease(game), oldRelease.formatRelease(game));
        equal(release.isUnreleased(game, now), oldRelease.isUnreleased(game, now));
        equal(release.releaseCountdown(game, now), oldRelease.releaseCountdown(game, now));
        equal(release.releaseSortKey(game), oldRelease.releaseSortKey(game));
        equal(
          release.formatRelease({ ...game, releaseDate: date.getTime() }),
          oldRelease.formatRelease(game),
        );
        equal(
          release.isUnreleased({ ...game, releaseDate: date.getTime() }, now),
          oldRelease.isUnreleased(game, now),
        );
      }
    }
    equal(groups.getSessionGroup(date, now), oldGroups.getSessionGroup(date, now));
  }
  const sessions = dates
    .map((startedAt, id) => ({ id, startedAt }))
    .sort((a, b) => +b.startedAt - +a.startedAt);
  equal(groups.groupPageByDate(sessions, now), oldGroups.groupPageByDate(sessions, now));
  for (let pass = 0; pass < 100; pass++) {
    const entries = dates.map((date, id) => ({
      id,
      unlockedAt: random() < 0.75 ? null : date,
      dateReliable: random() < 0.8,
    }));
    equal(achievements.sortAchievements(entries), oldAchievements.sortForDisplay(entries));
  }
  console.log(
    JSON.stringify({
      differentialAssertions: assertions,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );

  for (const size of [50, 10000]) {
    const page = Array.from({ length: size }, (_, id) => ({
      id,
      startedAt: new Date(2024, Math.floor(id / (size / 12)), 1 + (id % 28), 12),
    })).sort((a, b) => +b.startedAt - +a.startedAt);
    equal(groups.groupPageByDate(page, now), oldGroups.groupPageByDate(page, now));

    // Warm both functions and alternate order to limit JIT/order bias. Report
    // timings without asserting ratios; machine load must not break a test.
    oldGroups.groupPageByDate(page, now);
    groups.groupPageByDate(page, now);
    const before: number[] = [];
    const after: number[] = [];
    for (let run = 0; run < 7; run++) {
      const candidates = [
        { fn: oldGroups.groupPageByDate, samples: before },
        { fn: groups.groupPageByDate, samples: after },
      ];
      if (run % 2) candidates.reverse();
      for (const { fn, samples } of candidates) {
        const start = performance.now();
        fn(page, now);
        samples.push(performance.now() - start);
      }
    }
    const baselineMs = median(before);
    const refactorMs = median(after);
    console.log(
      JSON.stringify({ rows: size, baselineMs, refactorMs, speedup: baselineMs / refactorMs }),
    );
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
