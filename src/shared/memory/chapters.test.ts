import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameListItem, SessionWithGame, StateEventSummary } from '../types';
import { buildMonthChapters, buildYearChapters } from './chapters';

const game = (id: number, title: string, manualHours = 0): GameListItem => ({
  id,
  title,
  coverUrl: null,
  heroUrl: null,
  genres: null,
  isEmulated: false,
  endless: false,
  releaseYear: null,
  totalHours: manualHours,
  addedAt: new Date('2025-01-01T00:00:00Z'),
  hltbMain: null,
  manualIterations: manualHours > 0 ? [{ iterationId: id, hours: manualHours, year: 2025 }] : [],
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  sessionCount: 0,
});

const session = (id: number, gameId: number, title: string, date: string, hours: number): SessionWithGame => ({
  id,
  iterationId: gameId,
  isManual: false,
  startedAt: new Date(date),
  endedAt: new Date(new Date(date).getTime() + hours * 3600 * 1000),
  durationSec: hours * 3600,
  lastHeartbeatAt: null,
  datePrecision: 'datetime',
  note: null,
  gameId,
  gameTitle: title,
  coverUrl: null,
});

describe('local Chapters', () => {
  const now = new Date('2026-07-30T12:00:00Z');
  const games = [game(1, 'Alpha', 5), game(2, 'Beta')];
  const sessions = [
    session(1, 1, 'Alpha', '2025-03-01T10:00:00Z', 2),
    session(2, 2, 'Beta', '2025-03-02T10:00:00Z', 4),
  ];
  const events: StateEventSummary[] = [{
    id: 1,
    gameId: 2,
    iterationId: 2,
    type: 'completed',
    occurredAt: new Date('2025-03-02T14:00:00Z'),
    datePrecision: 'datetime',
    iterationLabel: 'Playthrough 1',
  }];

  it('builds tracked monthly facts without inventing empty months', () => {
    const chapters = buildMonthChapters(games, sessions, events, [], now);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0]?.hours, 6);
    assert.equal(chapters[0]?.topGameTitle, 'Beta');
    assert.equal(chapters[0]?.completed, 1);
  });

  it('adds annual manual hours to the canonical yearly total', () => {
    const chapters = buildYearChapters(games, sessions, events, [], now);
    assert.equal(chapters[0]?.hours, 11);
    assert.equal(chapters[0]?.games, 2);
  });
});