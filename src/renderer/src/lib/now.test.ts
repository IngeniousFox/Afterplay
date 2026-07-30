import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../shared/types';
import {
  buildOnThisDay,
  buildRotation,
  selectContinueGame,
  selectLastClosedSession,
  selectUpNext,
} from './now';

const game = (id: number, patch: Partial<GameListItem> = {}): GameListItem => ({
  id,
  title: `Game ${id}`,
  coverUrl: null,
  heroUrl: null,
  genres: null,
  isEmulated: false,
  endless: false,
  releaseYear: null,
  totalHours: 0,
  addedAt: new Date('2026-01-01T00:00:00Z'),
  hltbMain: null,
  manualIterations: [],
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  sessionCount: 0,
  ...patch,
});

const session = (id: number, patch: Partial<SessionWithGame> = {}): SessionWithGame => ({
  id,
  iterationId: 1,
  isManual: false,
  startedAt: new Date('2026-01-01T10:00:00Z'),
  endedAt: new Date('2026-01-01T11:00:00Z'),
  durationSec: 3600,
  lastHeartbeatAt: null,
  datePrecision: 'datetime',
  note: null,
  gameId: 1,
  gameTitle: 'Game 1',
  coverUrl: null,
  ...patch,
});

describe('Now projections', () => {
  const now = new Date('2026-07-30T12:00:00Z');

  it('prioritizes live, playing, then recent games in the rotation', () => {
    const games = [
      game(1, { lastPlayedAt: new Date('2026-07-29T00:00:00Z') }),
      game(2, { currentState: 'started', lastPlayedAt: new Date('2026-06-01T00:00:00Z') }),
      game(3, { isLive: true, lastPlayedAt: new Date('2026-05-01T00:00:00Z') }),
      game(4, { lastPlayedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    assert.deepEqual(
      buildRotation(games, now).map((candidate) => candidate.id),
      [3, 2, 1],
    );
  });

  it('selects the most recently active playing game and newest planned game', () => {
    assert.equal(
      selectContinueGame([
        game(1, { currentState: 'started', lastPlayedAt: new Date('2026-07-01T00:00:00Z') }),
        game(2, { currentState: 'started', lastPlayedAt: new Date('2026-07-20T00:00:00Z') }),
      ])?.id,
      2,
    );
    assert.equal(
      selectUpNext([
        game(3, { addedAt: new Date('2026-01-01T00:00:00Z') }),
        game(4, { addedAt: new Date('2026-07-01T00:00:00Z') }),
      ])?.id,
      4,
    );
  });

  it('selects the latest closed session', () => {
    assert.equal(
      selectLastClosedSession([
        session(1, { endedAt: new Date('2026-07-01T11:00:00Z') }),
        session(2, { endedAt: new Date('2026-07-29T11:00:00Z') }),
        session(3, { endedAt: null }),
      ])?.id,
      2,
    );
  });

  it('prefers a completed anniversary and ignores imprecise dates', () => {
    const games = [game(1)];
    const events: StateEventSummary[] = [
      {
        id: 1,
        gameId: 1,
        iterationId: 1,
        type: 'completed',
        occurredAt: new Date('2025-07-30T00:00:00Z'),
        datePrecision: 'day',
        iterationLabel: 'Playthrough 1',
      },
      {
        id: 2,
        gameId: 1,
        iterationId: 1,
        type: 'started',
        occurredAt: new Date('2024-07-30T00:00:00Z'),
        datePrecision: 'month',
        iterationLabel: 'Playthrough 1',
      },
    ];
    assert.equal(buildOnThisDay(games, [], events, now)?.kind, 'completed');
  });
});
