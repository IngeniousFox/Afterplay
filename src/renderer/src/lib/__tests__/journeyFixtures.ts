import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../../shared/types';

export const baseGame = (overrides: Partial<GameListItem> = {}): GameListItem => ({
  id: 1,
  igdbId: null,
  steamAppId: null,
  title: 'Test Game',
  coverUrl: null,
  heroUrl: null,
  genres: null,
  isEmulated: false,
  endless: false,
  releaseYear: null,
  totalHours: 0,
  addedAt: new Date(2020, 0, 1, 10, 0, 0),
  promotedAt: null,
  hltbMain: null,
  hltbMainExtras: null,
  hltbCompletionist: null,
  executablePath: null,
  manualIterations: [],
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  sessionCount: 0,
  ...overrides,
});

export const baseSession = (overrides: Partial<SessionWithGame> = {}): SessionWithGame => ({
  id: 1,
  iterationId: 10,
  isManual: false,
  startedAt: new Date(2021, 0, 1),
  endedAt: null,
  durationSec: 3600,
  lastHeartbeatAt: null,
  datePrecision: 'datetime',
  note: null,
  gameId: 1,
  gameTitle: 'Test Game',
  coverUrl: null,
  ...overrides,
});

export const baseEvent = (overrides: Partial<StateEventSummary> = {}): StateEventSummary => ({
  id: 1,
  gameId: 1,
  iterationId: 10,
  type: 'started',
  occurredAt: new Date(2021, 0, 1),
  datePrecision: 'datetime',
  iterationLabel: 'Playthrough 1',
  ...overrides,
});

// Archivo sintético para pruebas de escala y el benchmark reproducible.
// Nunca lee la biblioteca personal. Mezcla endless, vueltas y horas manuales.
export const syntheticJourney = (
  gameCount: number,
  sessionsPerGame: number,
): { games: GameListItem[]; sessions: SessionWithGame[]; events: StateEventSummary[] } => {
  const games: GameListItem[] = [];
  const sessions: SessionWithGame[] = [];
  const events: StateEventSummary[] = [];
  for (let gameId = 1; gameId <= gameCount; gameId++) {
    const manualIterations = [] as GameListItem['manualIterations'];
    for (let iteration = 0; iteration < 3; iteration++) {
      const iterationId = gameId * 10 + iteration;
      manualIterations.push({ iterationId, hours: 2, year: 2021 + iteration });
      events.push(
        baseEvent({
          id: events.length + 1,
          gameId,
          iterationId,
          type: 'started',
          occurredAt: new Date(2021 + iteration, 0, 1),
        }),
      );
    }
    for (let i = 0; i < sessionsPerGame; i++) {
      const at = new Date(2021 + (i % 3), i % 12, 1 + (i % 27), i % 24);
      sessions.push(
        baseSession({
          id: sessions.length + 1,
          gameId,
          iterationId: gameId * 10 + (i % 3),
          startedAt: at,
          endedAt: new Date(at.getTime() + 3600_000),
          note: i % 5 === 0 ? `Note ${i}` : null,
        }),
      );
    }
    games.push(
      baseGame({
        id: gameId,
        endless: gameId % 2 === 0,
        manualIterations,
        totalHours: sessionsPerGame + 6,
      }),
    );
  }
  return { games, sessions, events };
};
