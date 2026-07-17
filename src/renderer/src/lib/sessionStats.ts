type DurationSession = { endedAt: Date | null; durationSec: number | null };

// Duración de sesión más larga y media — solo sobre sesiones CERRADAS (una en
// marcha no tiene duración final todavía). Duplicado en Sessions.tsx y
// GameStats.tsx.
export const sessionDurationStats = (
  sessions: DurationSession[],
): { longestSec: number; avgSec: number } => {
  const closed = sessions.filter((session) => session.endedAt !== null);
  const longestSec = closed.reduce((max, session) => Math.max(max, session.durationSec ?? 0), 0);
  const avgSec =
    closed.length > 0
      ? closed.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / closed.length
      : 0;
  return { longestSec, avgSec };
};
