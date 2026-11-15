import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveStatsSummary, type StatsGame } from '../statsSummary';

// La regla del resumen de la portada, sin base de datos.

const game = (id: number, overrides: Partial<StatsGame<number>> = {}): StatsGame<number> => ({
  id,
  title: `Juego ${id}`,
  coverUrl: null,
  totalHours: 0,
  sessionCount: 0,
  currentState: null,
  isLive: false,
  liveSince: null,
  manualIterations: [],
  ...overrides,
});

const NOW = new Date('2026-06-15T12:00:00Z');

describe('deriveStatsSummary', () => {
  it('los seis cajones de estado suman exactamente el total de juegos', () => {
    const states = ['completed', 'started', 'dropped', 'on_hold', 'resting', null] as const;
    const games = states.map((currentState, i) => game(i + 1, { currentState }));
    const summary = deriveStatsSummary({ games, sessions: [], now: NOW });
    const { beaten, playing, dropped, onHold, resting, unplayed } = summary;
    assert.deepEqual([beaten, playing, dropped, onHold, resting, unplayed], [1, 1, 1, 1, 1, 1]);
    assert.equal(beaten + playing + dropped + onHold + resting + unplayed, summary.totalGames);
  });

  it('las horas del año son sesiones de ese año MÁS manuales atribuidas a él', () => {
    const games = [
      game(1, { manualIterations: [{ iterationId: 1, hours: 10, year: 2026 }] }),
      game(2, { manualIterations: [{ iterationId: 2, hours: 50, year: 2019 }] }),
      game(3),
    ];
    const sessions = [
      { gameId: 1, startedAt: new Date('2026-03-01T12:00:00Z'), durationSec: 7200 },
      { gameId: 1, startedAt: new Date('2025-03-01T12:00:00Z'), durationSec: 3600 },
      // Un juego fuera de la población (p. ej. del Plan) no suma.
      { gameId: 9, startedAt: new Date('2026-03-01T12:00:00Z'), durationSec: 3600 },
    ];
    const summary = deriveStatsSummary({ games, sessions, now: NOW });
    assert.equal(summary.year, 2026);
    assert.equal(summary.hoursThisYear, 12);
    assert.equal(summary.gamesThisYear, 1);
  });

  it('el año se lee en la zona de quien mira', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    const sessions = [
      { gameId: 1, startedAt: new Date('2026-12-31T22:30:00Z'), durationSec: 3600 },
    ];
    const utc = deriveStatsSummary({ games: [game(1)], sessions, now, timeZone: 'UTC' });
    const madrid = deriveStatsSummary({
      games: [game(1)],
      sessions,
      now,
      timeZone: 'Europe/Madrid',
    });
    assert.equal(utc.year, 2026);
    assert.equal(utc.hoursThisYear, 1);
    assert.equal(madrid.year, 2027);
    assert.equal(madrid.hoursThisYear, 0);
  });

  it('elige la sesión abierta más reciente y cuenta jugados', () => {
    const games = [
      game(1, { isLive: true, liveSince: new Date(1000), totalHours: 3, sessionCount: 2 }),
      game(2, { isLive: true, liveSince: new Date(5000), title: 'Nuevo', totalHours: 1 }),
    ];
    const summary = deriveStatsSummary({ games, sessions: [], now: NOW });
    assert.deepEqual(summary.live, { gameId: 2, gameTitle: 'Nuevo', coverUrl: null, since: 5000 });
    assert.equal(summary.playedGames, 2);
    assert.equal(summary.totalHours, 4);
    assert.equal(summary.totalSessions, 2);
  });
});
