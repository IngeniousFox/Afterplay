import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSessionMoments, type MomentSession } from './moments';

const session = (
  id: number,
  startedAt: string,
  durationSec = 3600,
): MomentSession => ({
  id,
  iterationId: 1,
  startedAt: new Date(startedAt),
  durationSec,
});

describe('Journey Moments', () => {
  it('marks the first tracked session once', () => {
    const current = session(1, '2026-01-01T10:00:00Z');
    const moments = buildSessionMoments({ gameId: 4, current, sessions: [current], totalHours: 1 });
    assert.deepEqual(moments.map((moment) => moment.type), ['first_session']);
  });

  it('detects a major return from the previous session', () => {
    const previous = session(1, '2025-01-01T10:00:00Z');
    const current = session(2, '2026-02-01T10:00:00Z');
    const moments = buildSessionMoments({
      gameId: 4,
      current,
      sessions: [previous, current],
      totalHours: 2,
    });
    assert.equal(moments[0]?.type, 'return');
    assert.match(moments[0]?.text ?? '', /year/);
  });

  it('emits only the highest hours threshold crossed by this session', () => {
    const current = session(2, '2026-02-01T10:00:00Z', 2 * 3600);
    const moments = buildSessionMoments({
      gameId: 4,
      current,
      sessions: [session(1, '2026-01-31T10:00:00Z'), current],
      totalHours: 101,
    });
    assert.deepEqual(
      moments.filter((moment) => moment.type === 'hours_milestone').map((moment) => moment.text),
      ['You crossed 100 hours'],
    );
  });

  it('detects session count and strict duration records', () => {
    const sessions = Array.from({ length: 9 }, (_, index) =>
      session(index + 1, `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00Z`, 1800),
    );
    const current = session(10, '2026-01-10T10:00:00Z', 3600);
    sessions.push(current);
    const moments = buildSessionMoments({ gameId: 4, current, sessions, totalHours: 6 });
    assert.deepEqual(
      moments.map((moment) => moment.type).sort(),
      ['longest_session', 'sessions_milestone'],
    );
  });
});