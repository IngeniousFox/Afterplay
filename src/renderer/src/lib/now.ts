import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ROTATION_WINDOW_DAYS = 30;

const activityTime = (game: GameListItem): number =>
  game.lastPlayedAt?.getTime() ?? game.addedAt.getTime();

export const buildRotation = (games: GameListItem[], now: Date, limit = 5): GameListItem[] => {
  const recentCutoff = now.getTime() - ROTATION_WINDOW_DAYS * DAY_MS;
  return games
    .filter(
      (game) =>
        game.isLive ||
        game.currentState === 'started' ||
        (game.lastPlayedAt?.getTime() ?? 0) >= recentCutoff,
    )
    .sort((a, b) => {
      const live = Number(b.isLive) - Number(a.isLive);
      if (live !== 0) return live;
      const playing = Number(b.currentState === 'started') - Number(a.currentState === 'started');
      if (playing !== 0) return playing;
      return activityTime(b) - activityTime(a);
    })
    .slice(0, limit);
};

export const selectContinueGame = (games: GameListItem[]): GameListItem | null =>
  [...games]
    .filter((game) => game.currentState === 'started')
    .sort((a, b) => activityTime(b) - activityTime(a))[0] ?? null;

export const selectLastClosedSession = (sessions: SessionWithGame[]): SessionWithGame | null =>
  [...sessions]
    .filter((session) => session.endedAt !== null)
    .sort(
      (a, b) =>
        (b.endedAt?.getTime() ?? b.startedAt.getTime()) -
        (a.endedAt?.getTime() ?? a.startedAt.getTime()),
    )[0] ?? null;

export const selectUpNext = (plannedGames: GameListItem[]): GameListItem | null =>
  [...plannedGames].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())[0] ?? null;

export type OnThisDayMemory = {
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
  occurredAt: Date;
  kind: 'started' | 'completed' | 'session';
};

const isSameCalendarDayInPastYear = (date: Date, now: Date): boolean =>
  date.getFullYear() < now.getFullYear() &&
  date.getMonth() === now.getMonth() &&
  date.getDate() === now.getDate();

export const buildOnThisDay = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  stateEvents: StateEventSummary[],
  now: Date,
): OnThisDayMemory | null => {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const memories: Array<OnThisDayMemory & { priority: number }> = [];

  for (const event of stateEvents) {
    if (
      (event.datePrecision !== 'day' && event.datePrecision !== 'datetime') ||
      !isSameCalendarDayInPastYear(event.occurredAt, now) ||
      (event.type !== 'started' && event.type !== 'completed')
    ) {
      continue;
    }
    const game = gameById.get(event.gameId);
    if (!game) continue;
    memories.push({
      gameId: game.id,
      gameTitle: game.title,
      coverUrl: game.coverUrl,
      occurredAt: event.occurredAt,
      kind: event.type,
      priority: event.type === 'completed' ? 3 : 2,
    });
  }

  for (const session of sessions) {
    if (
      (session.datePrecision !== 'day' && session.datePrecision !== 'datetime') ||
      !isSameCalendarDayInPastYear(session.startedAt, now)
    ) {
      continue;
    }
    memories.push({
      gameId: session.gameId,
      gameTitle: session.gameTitle,
      coverUrl: session.coverUrl,
      occurredAt: session.startedAt,
      kind: 'session',
      priority: 1,
    });
  }

  const selected = memories.sort(
    (a, b) => b.priority - a.priority || b.occurredAt.getTime() - a.occurredAt.getTime(),
  )[0];
  if (!selected) return null;
  return {
    gameId: selected.gameId,
    gameTitle: selected.gameTitle,
    coverUrl: selected.coverUrl,
    occurredAt: selected.occurredAt,
    kind: selected.kind,
  };
};
