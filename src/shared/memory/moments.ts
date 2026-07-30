import type { GameListItem, JourneyMoment, SessionWithGame } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETURN_THRESHOLDS = [365, 90, 30] as const;
const HOUR_THRESHOLDS = [500, 250, 100, 50, 25, 10] as const;
const SESSION_THRESHOLDS = [250, 100, 50, 25, 10] as const;

export type MomentSession = {
  id: number;
  iterationId: number | null;
  startedAt: Date;
  durationSec: number | null;
};

export type BuildSessionMomentsInput = {
  gameId: number;
  current: MomentSession;
  sessions: MomentSession[];
  totalHours: number;
};

const formatGap = (days: number): string => {
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  if (days >= 60) return `${Math.floor(days / 30)} months`;
  return `${days} days`;
};

export const buildSessionMoments = ({
  gameId,
  current,
  sessions,
  totalHours,
}: BuildSessionMomentsInput): JourneyMoment[] => {
  const closed = sessions
    .filter((session) => session.durationSec !== null)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const previous = closed.filter(
    (session) =>
      session.id !== current.id && session.startedAt.getTime() <= current.startedAt.getTime(),
  );
  const moments: JourneyMoment[] = [];
  const base = {
    gameId,
    sessionId: current.id,
    iterationId: current.iterationId,
    occurredAt: current.startedAt,
    precision: 'datetime' as const,
  };

  if (previous.length === 0) {
    moments.push({
      ...base,
      key: `first-session:game:${gameId}`,
      type: 'first_session',
      importance: 100,
      text: 'Your first tracked session with this game',
    });
  } else {
    const latest = previous.at(-1);
    if (latest) {
      const gapDays = Math.floor(
        (current.startedAt.getTime() - latest.startedAt.getTime()) / DAY_MS,
      );
      const threshold = RETURN_THRESHOLDS.find((candidate) => gapDays >= candidate);
      if (threshold !== undefined) {
        moments.push({
          ...base,
          key: `return:game:${gameId}:session:${current.id}`,
          type: 'return',
          importance: threshold === 365 ? 95 : threshold === 90 ? 80 : 60,
          text: `You returned after ${formatGap(gapDays)} away`,
        });
      }
    }
  }

  const currentHours = (current.durationSec ?? 0) / 3600;
  const beforeHours = Math.max(0, totalHours - currentHours);
  const crossedHours = HOUR_THRESHOLDS.find(
    (threshold) => beforeHours < threshold && totalHours >= threshold,
  );
  if (crossedHours !== undefined) {
    moments.push({
      ...base,
      key: `hours:game:${gameId}:${crossedHours}`,
      type: 'hours_milestone',
      importance: crossedHours >= 100 ? 90 : 70,
      text: `You crossed ${crossedHours} hours`,
    });
  }

  const currentIndex = closed.findIndex((session) => session.id === current.id);
  const sessionCount = currentIndex < 0 ? closed.length : currentIndex + 1;
  const crossedSessions = SESSION_THRESHOLDS.find((threshold) => sessionCount === threshold);
  if (crossedSessions !== undefined) {
    moments.push({
      ...base,
      key: `sessions:game:${gameId}:${crossedSessions}`,
      type: 'sessions_milestone',
      importance: crossedSessions >= 100 ? 75 : 55,
      text: `Session ${crossedSessions} with this game`,
    });
  }

  const durationSec = current.durationSec ?? 0;
  const previousLongest = previous.reduce(
    (longest, session) => Math.max(longest, session.durationSec ?? 0),
    0,
  );
  if (previous.length > 0 && durationSec > previousLongest) {
    moments.push({
      ...base,
      key: `longest-session:game:${gameId}:session:${current.id}`,
      type: 'longest_session',
      importance: 65,
      text: 'Your longest session with this game',
    });
  }

  return moments.sort((a, b) => b.importance - a.importance);
};

export const buildJourneyMoments = (
  games: GameListItem[],
  sessions: SessionWithGame[],
): JourneyMoment[] => {
  const sessionsByGame = new Map<number, SessionWithGame[]>();
  for (const session of sessions) {
    if (session.endedAt === null || session.durationSec === null) continue;
    const list = sessionsByGame.get(session.gameId) ?? [];
    list.push(session);
    sessionsByGame.set(session.gameId, list);
  }

  const moments: JourneyMoment[] = [];
  for (const game of games) {
    const gameSessions = (sessionsByGame.get(game.id) ?? []).sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
    let trackedHours = 0;
    for (const current of gameSessions) {
      trackedHours += (current.durationSec ?? 0) / 3600;
      const manualHours = game.manualIterations
        .filter(
          (manual) => manual.year === null || manual.year <= current.startedAt.getFullYear(),
        )
        .reduce((sum, manual) => sum + manual.hours, 0);
      moments.push(
        ...buildSessionMoments({
          gameId: game.id,
          current,
          sessions: gameSessions,
          totalHours: manualHours + trackedHours,
        }),
      );
    }
  }
  return moments;
};