import { monthKey, startOfDayMs } from './dateMath';

type ActivitySession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
};

// Agrupa las sesiones cerradas una sola vez. Cada pantalla decide antes si
// incluye el registro manual antiguo y qué año está mirando.
export const sessionActivity = <T extends ActivitySession>(
  sessions: readonly T[],
): {
  longest: T | null;
  biggestDay: { dayMs: number; seconds: number } | null;
  busiestMonth: { monthKey: number; seconds: number } | null;
  daysPlayed: number;
} => {
  let longest: T | null = null;
  const secondsByDay = new Map<number, number>();
  const secondsByMonth = new Map<number, number>();
  for (const session of sessions) {
    if (session.endedAt === null) continue;
    const seconds = session.durationSec ?? 0;
    if (!longest || seconds > (longest.durationSec ?? 0)) longest = session;
    const day = startOfDayMs(session.startedAt);
    const month = monthKey(session.startedAt);
    secondsByDay.set(day, (secondsByDay.get(day) ?? 0) + seconds);
    secondsByMonth.set(month, (secondsByMonth.get(month) ?? 0) + seconds);
  }

  // Los empates conservan el primer grupo encontrado, como el sort estable
  // que usaba Stats. Comparar después de sumar evita desempatar por el
  // instante en que un grupo alcanzó su total.
  let biggestDay: { dayMs: number; seconds: number } | null = null;
  for (const [dayMs, seconds] of secondsByDay) {
    if (!biggestDay || seconds > biggestDay.seconds) biggestDay = { dayMs, seconds };
  }
  let busiestMonth: { monthKey: number; seconds: number } | null = null;
  for (const [month, seconds] of secondsByMonth) {
    if (!busiestMonth || seconds > busiestMonth.seconds)
      busiestMonth = { monthKey: month, seconds };
  }
  return { longest, biggestDay, busiestMonth, daysPlayed: secondsByDay.size };
};
