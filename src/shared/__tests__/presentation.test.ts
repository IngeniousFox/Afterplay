import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortAchievements } from '../achievements';
import { addDays, calendarDaysBetween, humanizeSpanByPrecision } from '../dateMath';
import { formatByPrecision, formatSessionEndTime, formatTime } from '../format';
import { createStatusMeta, STATE_TO_STATUS_KEY } from '../gameStatus';
import { countdownLabel, formatRelease, releaseCountdown, releaseSortKey } from '../releaseDate';
import { groupPageByDate } from '../sessionGroups';

describe('shared presentation contracts', () => {
  it('preserves clock preferences and never adds a clock to a coarse date', () => {
    const date = new Date(2026, 8, 6, 18, 30);
    assert.equal(formatTime(date, '24h'), '18:30');
    assert.equal(formatTime(date, '12h'), '06:30 PM');
    assert.equal(formatByPrecision(date, 'year', '12h'), '2026');
    assert.equal(formatByPrecision(date, 'month', '24h'), 'September 2026');
    assert.equal(formatByPrecision(date, 'day', '12h'), 'September 6, 2026');
    assert.equal(formatByPrecision(date, 'datetime', '24h'), 'Sep 6, 2026 · 18:30');
    assert.equal(formatSessionEndTime(date, 'day', '24h'), null);
    assert.equal(formatSessionEndTime(null, 'datetime', '24h'), null);
    assert.equal(formatSessionEndTime(date, 'datetime', '12h'), '06:30 PM');
  });

  it('does not mutate dates while adding days or calculating elapsed spans', () => {
    const date = new Date(2026, 2, 28, 23, 0);
    const original = date.getTime();
    const next = addDays(date, 1);
    assert.equal(date.getTime(), original);
    assert.equal(next.getDate(), 29);
    assert.equal(next.getHours(), 23);
    assert.equal(calendarDaysBetween(date, next), 1);
    const end = new Date(2026, 2, 29, 1, 0);
    assert.equal(humanizeSpanByPrecision(date, end, 'datetime', 'datetime'), 'less than a day');
    assert.equal(humanizeSpanByPrecision(date, end, 'year', 'datetime'), 'Same year');
  });

  it('treats timestamp zero as a release date rather than falling back to a year', () => {
    for (const releaseDate of [0, new Date(0)]) {
      const game = { releaseDate, releaseDatePrecision: 'year' as const, releaseYear: 2027 };
      assert.equal(formatRelease(game), String(new Date(0).getFullYear()));
      assert.equal(releaseSortKey(game), 0);
    }
    assert.equal(
      releaseSortKey({ releaseDate: null, releaseDatePrecision: null, releaseYear: 2027 }),
      Date.UTC(2027, 0, 1),
    );
    assert.equal(
      formatRelease({ releaseDate: null, releaseDatePrecision: null, releaseYear: null }),
      null,
    );
  });

  it('uses the same countdown boundaries for Dates and JSON timestamps', () => {
    const now = new Date(2026, 8, 6, 18, 0);
    const expected = new Map([
      [-22, null],
      [-21, 'OUT NOW'],
      [-1, 'OUT NOW'],
      [0, 'Out today!'],
      [1, 'Out tomorrow'],
      [7, 'Out in 7 days'],
      [8, 'Out in 8 days'],
      [30, 'Out in 30 days'],
      [31, null],
    ]);
    for (const [days, label] of expected) {
      const date = addDays(now, days);
      for (const releaseDate of [date, date.getTime()]) {
        const countdown = releaseCountdown(
          { releaseDate, releaseDatePrecision: 'day', releaseYear: 2026 },
          now,
        );
        assert.equal(countdown === null ? null : countdownLabel(countdown), label);
        if (countdown?.kind === 'soon') assert.equal(countdown.imminent, days <= 7);
      }
    }
  });

  it('sorts achievement subsets without mutating or copying the caller records', () => {
    const entries = Object.freeze([
      Object.freeze({ id: 'locked-a', unlockedAt: null, dateReliable: false, extra: 'preserved' }),
      Object.freeze({ id: 'rescued', unlockedAt: new Date(9000), dateReliable: false }),
      Object.freeze({ id: 'epoch', unlockedAt: 0, dateReliable: true }),
      Object.freeze({ id: 'newer-a', unlockedAt: new Date(2000), dateReliable: true }),
      Object.freeze({ id: 'locked-b', unlockedAt: null, dateReliable: true }),
      Object.freeze({ id: 'newer-b', unlockedAt: 2000, dateReliable: true }),
    ]);
    const sorted = sortAchievements(entries);
    assert.deepEqual(
      sorted.map(({ id }) => id),
      ['newer-a', 'newer-b', 'epoch', 'rescued', 'locked-a', 'locked-b'],
    );
    assert.equal(sorted[0], entries[3]);
    assert.equal(sorted[4], entries[0]);
    assert.equal(entries[0].id, 'locked-a');
    assert.deepEqual(sortAchievements([]), []);
  });

  it('groups Date and timestamp rows without retaining a previous page or clock', () => {
    const december = new Date(2025, 11, 1, 12);
    const january = new Date(2026, 0, 1, 12);
    const entries = Object.freeze([
      Object.freeze({ id: 1, startedAt: december }),
      Object.freeze({ id: 2, startedAt: december.getTime() }),
      Object.freeze({ id: 3, startedAt: january }),
      Object.freeze({ id: 4, startedAt: december }),
    ]);
    const groups = groupPageByDate(entries, new Date(2026, 0, 30));
    assert.deepEqual(
      groups.map(({ label, monthScopeKey, sessions }) => ({
        label,
        monthScopeKey,
        ids: sessions.map(({ id }) => id),
      })),
      [
        { label: 'Last Month', monthScopeKey: '2025-12', ids: [1, 2] },
        { label: 'This Month', monthScopeKey: null, ids: [3] },
        { label: 'Last Month', monthScopeKey: '2025-12', ids: [4] },
      ],
    );
    assert.equal(groups[0].sessions[0], entries[0]);
    assert.equal(groupPageByDate(entries.slice(3), new Date(2026, 1, 1))[0].label, 'December 2025');
    assert.deepEqual(groupPageByDate([], new Date(2026, 0, 30)), []);
  });

  it('keeps localized month formatting proportional to months, rather than session count', (t) => {
    const original = Date.prototype.toLocaleDateString;
    const formatter = t.mock.method(
      Date.prototype,
      'toLocaleDateString',
      function (this: Date, ...args: Parameters<Date['toLocaleDateString']>): string {
        return original.apply(this, args);
      },
    );
    const page = Array.from({ length: 1000 }, (_, id) => ({
      id,
      startedAt: new Date(2024, id < 500 ? 2 : 3, 1 + (id % 28), 12),
    }));
    const groups = groupPageByDate(page, new Date(2026, 0, 30));
    assert.deepEqual(
      groups.map(({ label }) => label),
      ['March 2024', 'April 2024'],
    );
    assert.equal(groups[0].sessions.length, 500);
    assert.ok(formatter.mock.callCount() <= 2, 'formatting cost must follow distinct months');
  });

  it('keeps status labels, colors and icon identities independent of the rendering library', () => {
    const icons = {
      Play: {},
      Trophy: {},
      XCircle: {},
      Pause: {},
      Moon: {},
      Circle: {},
      Bookmark: {},
    };
    const metadata = createStatusMeta(icons);
    assert.deepEqual(metadata.playing, {
      label: 'Playing',
      color: '#2fdc7e',
      filled: true,
      Icon: icons.Play,
    });
    assert.deepEqual(metadata.unplayed, {
      label: 'Unplayed',
      color: '#888f8a',
      filled: false,
      Icon: icons.Circle,
    });
    assert.equal(metadata.plan.Icon, icons.Bookmark);
    assert.deepEqual(STATE_TO_STATUS_KEY, {
      started: 'playing',
      completed: 'beaten',
      dropped: 'dropped',
      on_hold: 'on_hold',
      resting: 'resting',
      plan_to_play: 'plan',
    });
  });
});
