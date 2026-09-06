import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionActivity } from '../sessionActivity';
import { hasMeasuredDuration } from '../sessionStats';
import { baseSession } from './journeyFixtures';

describe('sessionActivity', () => {
  it('sin sesiones cerradas no inventa récords', () => {
    assert.deepEqual(sessionActivity([baseSession({ durationSec: 999999 })]), {
      longest: null,
      biggestDay: null,
      busiestMonth: null,
      daysPlayed: 0,
    });
  });

  it('suma por día y mes local y mantiene el primer grupo en empates', () => {
    const a = new Date(2024, 1, 2, 23);
    const b = new Date(2024, 2, 3, 1);
    const sessions = [
      baseSession({ id: 1, startedAt: a, endedAt: a, durationSec: 10 }),
      baseSession({ id: 2, startedAt: b, endedAt: b, durationSec: 30 }),
      baseSession({ id: 3, startedAt: a, endedAt: a, durationSec: 20 }),
    ];
    Object.freeze(sessions);
    const result = sessionActivity(sessions);
    assert.equal(result.longest, sessions[1]);
    assert.deepEqual(result.biggestDay, { dayMs: new Date(2024, 1, 2).getTime(), seconds: 30 });
    assert.deepEqual(result.busiestMonth, { monthKey: 2024 * 12 + 1, seconds: 30 });
    assert.equal(result.daysPlayed, 2);
  });

  it('cada pantalla conserva su política de sesiones manuales y año', () => {
    const at = new Date(2024, 4, 1);
    const measured = baseSession({ id: 1, startedAt: at, endedAt: at, durationSec: 60 });
    const legacy = baseSession({
      id: 2,
      startedAt: at,
      endedAt: at,
      isManual: true,
      durationSec: 600,
    });
    const previous = baseSession({
      id: 3,
      startedAt: new Date(2023, 1, 1),
      endedAt: at,
      durationSec: 900,
    });
    const sessions = [measured, legacy, previous];
    assert.equal(sessionActivity(sessions).longest, previous);
    const records = sessionActivity(
      sessions.filter((item) => hasMeasuredDuration(item) && item.startedAt.getFullYear() === 2024),
    );
    assert.equal(records.longest, measured);
    assert.equal(records.biggestDay?.seconds, 60);
  });

  it('mantiene días de duración cero y resuelve empates de sesión por orden de entrada', () => {
    const at = new Date(2024, 11, 31);
    const first = baseSession({ id: 1, startedAt: at, endedAt: at, durationSec: null });
    const second = baseSession({ id: 2, startedAt: at, endedAt: at, durationSec: 0 });
    const result = sessionActivity([first, second]);
    assert.equal(result.longest, first);
    assert.equal(result.daysPlayed, 1);
    assert.equal(result.biggestDay?.seconds, 0);
    assert.equal(result.busiestMonth?.monthKey, 2024 * 12 + 11);
  });
});
