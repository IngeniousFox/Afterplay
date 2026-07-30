import type {
  GameListItem,
  JourneyMoment,
  LocalChapter,
  SessionWithGame,
  StateEventSummary,
} from '../types';

type ChapterBucket = {
  hoursByGame: Map<number, number>;
  gameIds: Set<number>;
  sessions: number;
  completed: number;
  longestSessionSec: number;
  moments: JourneyMoment[];
};

const bucket = (): ChapterBucket => ({
  hoursByGame: new Map(),
  gameIds: new Set(),
  sessions: 0,
  completed: 0,
  longestSessionSec: 0,
  moments: [],
});

const topGameTitle = (
  hoursByGame: Map<number, number>,
  gameById: Map<number, GameListItem>,
): string | null => {
  let topId: number | null = null;
  let topHours = -1;
  for (const [gameId, hours] of hoursByGame) {
    if (hours > topHours) {
      topId = gameId;
      topHours = hours;
    }
  }
  return topId === null ? null : (gameById.get(topId)?.title ?? null);
};

const chapterNarrative = (
  games: number,
  sessions: number,
  completed: number,
  topTitle: string | null,
): string => {
  const parts = [
    `${games} ${games === 1 ? 'game' : 'games'} across ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`,
  ];
  if (completed > 0) parts.push(`${completed} ${completed === 1 ? 'completion' : 'completions'}`);
  if (topTitle) parts.push(`${topTitle} led the way`);
  return `${parts.join(' · ')}.`;
};

const addSession = (target: ChapterBucket, session: SessionWithGame): void => {
  if (session.endedAt === null || session.durationSec === null) return;
  const hours = session.durationSec / 3600;
  target.hoursByGame.set(
    session.gameId,
    (target.hoursByGame.get(session.gameId) ?? 0) + hours,
  );
  target.gameIds.add(session.gameId);
  target.sessions++;
  target.longestSessionSec = Math.max(target.longestSessionSec, session.durationSec);
};

export const buildMonthChapters = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  stateEvents: StateEventSummary[],
  moments: JourneyMoment[],
  now: Date,
): LocalChapter[] => {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const buckets = new Map<string, ChapterBucket>();
  const get = (year: number, month: number): ChapterBucket => {
    const key = `${year}-${month}`;
    const value = buckets.get(key) ?? bucket();
    buckets.set(key, value);
    return value;
  };

  for (const session of sessions) {
    addSession(get(session.startedAt.getFullYear(), session.startedAt.getMonth()), session);
  }
  for (const event of stateEvents) {
    if (event.type !== 'completed') continue;
    const value = get(event.occurredAt.getFullYear(), event.occurredAt.getMonth());
    value.completed++;
    value.gameIds.add(event.gameId);
  }
  for (const moment of moments) {
    get(moment.occurredAt.getFullYear(), moment.occurredAt.getMonth()).moments.push(moment);
  }

  return [...buckets.entries()]
    .map(([key, value]) => {
      const [year, month] = key.split('-').map(Number);
      const title = topGameTitle(value.hoursByGame, gameById);
      return {
        key: `month:${key}`,
        kind: 'month' as const,
        year,
        month,
        hours: [...value.hoursByGame.values()].reduce((sum, hours) => sum + hours, 0),
        sessions: value.sessions,
        games: value.gameIds.size,
        completed: value.completed,
        topGameTitle: title,
        longestSessionSec: value.longestSessionSec,
        moments: value.moments.sort((a, b) => b.importance - a.importance).slice(0, 5),
        soFar: year === now.getFullYear() && month === now.getMonth(),
        narrative: chapterNarrative(value.gameIds.size, value.sessions, value.completed, title),
      };
    })
    .filter((chapter) => chapter.sessions > 0 || chapter.completed > 0 || chapter.moments.length > 0)
    .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0));
};

export const buildYearChapters = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  stateEvents: StateEventSummary[],
  moments: JourneyMoment[],
  now: Date,
): LocalChapter[] => {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const buckets = new Map<number, ChapterBucket>();
  const get = (year: number): ChapterBucket => {
    const value = buckets.get(year) ?? bucket();
    buckets.set(year, value);
    return value;
  };

  for (const session of sessions) addSession(get(session.startedAt.getFullYear()), session);
  for (const game of games) {
    for (const manual of game.manualIterations) {
      if (manual.year === null) continue;
      const value = get(manual.year);
      value.hoursByGame.set(game.id, (value.hoursByGame.get(game.id) ?? 0) + manual.hours);
      value.gameIds.add(game.id);
    }
  }
  for (const event of stateEvents) {
    if (event.type !== 'completed') continue;
    const value = get(event.occurredAt.getFullYear());
    value.completed++;
    value.gameIds.add(event.gameId);
  }
  for (const moment of moments) get(moment.occurredAt.getFullYear()).moments.push(moment);

  return [...buckets.entries()]
    .map(([year, value]) => {
      const title = topGameTitle(value.hoursByGame, gameById);
      return {
        key: `year:${year}`,
        kind: 'year' as const,
        year,
        month: null,
        hours: [...value.hoursByGame.values()].reduce((sum, hours) => sum + hours, 0),
        sessions: value.sessions,
        games: value.gameIds.size,
        completed: value.completed,
        topGameTitle: title,
        longestSessionSec: value.longestSessionSec,
        moments: value.moments.sort((a, b) => b.importance - a.importance).slice(0, 10),
        soFar: year === now.getFullYear(),
        narrative: chapterNarrative(value.gameIds.size, value.sessions, value.completed, title),
      };
    })
    .filter((chapter) => chapter.hours > 0 || chapter.completed > 0 || chapter.moments.length > 0)
    .sort((a, b) => b.year - a.year);
};