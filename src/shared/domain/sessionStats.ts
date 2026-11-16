import { DAY_MS, monthKey, startOfDayMs } from '../dateMath';
import type { EntityId, EntityIdLike, GameId, IterationId, SessionId } from '../entityIds';
import { yearOf } from '../yearOf';
import { hasMeasuredDuration, isMeasuredSession } from './sessionMeasure';

// LAS CIFRAS DE SESIONES QUE ENSEÑAN LAS ESTADÍSTICAS, escritas UNA vez
// (AFTERPLAY-2.0.md §15.6, F-41).
//
// Antes cada gráfica de Stats recorría TODAS las sesiones de la biblioteca en
// el renderer. Ahora el main reduce las filas a este resumen compacto
// (`buildSessionStats`) y el renderer solo lo lee a través de las funciones de
// vista de abajo. Las gráficas de UN juego (GameStats) construyen el mismo
// resumen con las sesiones de ese juego, así que la regla es una para las dos.
//
// Lo que NO hace: decidir qué sesiones existen. Quien llama pasa las filas
// vivas (regla F-11) en el orden de siempre — más reciente primero, a igual
// inicio la creada después primero —, porque varios empates (el día o el mes
// más cargado, la sesión más larga) se resuelven "gana la primera que aparece".

/** Lo mínimo que hace falta de una sesión con su juego. `SessionWithGame` lo cumple. */
export type StatsSessionRow<Id extends EntityIdLike = EntityId> = {
  id: SessionId<Id>;
  gameId: GameId<Id>;
  iterationId: IterationId<Id>;
  gameTitle: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

/**
 * Un día local con sesiones MEDIDAS (no manuales). `opened` cuenta también las
 * aún abiertas (abrir una sesión ya pinta el día en rachas); `closed` y
 * `seconds` solo las cerradas, que son las que tienen duración final.
 */
export type StatsDay = { dayMs: number; opened: number; closed: number; seconds: number };

/**
 * Los límites superiores (exclusivos, en segundos) de los tramos del
 * histograma de duración; el último tramo es abierto: <30m, 30m–1h, 1–2h,
 * 2–4h, 4h+.
 */
export const SESSION_LENGTH_LIMITS_SEC: readonly number[] = [30 * 60, 60 * 60, 2 * 3600, 4 * 3600];

export const sessionLengthBucket = (seconds: number): number => {
  const index = SESSION_LENGTH_LIMITS_SEC.findIndex((limit) => seconds < limit);
  return index >= 0 ? index : SESSION_LENGTH_LIMITS_SEC.length;
};

/** La distribución de duración de las sesiones medidas y cerradas de un periodo. */
export type SessionLengthSummary = {
  /** Cuántas caen en cada tramo (`SESSION_LENGTH_LIMITS_SEC.length + 1` tramos). */
  counts: number[];
  total: number;
  medianSec: number;
  longestSec: number;
  /** Las de menos de una hora. */
  underHour: number;
};

export type LongestSession = { durationSec: number; gameTitle: string };

/** El ritmo de los últimos `PACE_WINDOW_DAYS` días (BacklogDebtCard). */
export const PACE_WINDOW_DAYS = 90;

export type SessionStats<Id extends EntityIdLike = EntityId> = {
  /** Años locales con alguna sesión (de cualquier tipo), de mayor a menor. */
  years: number[];
  /** Días con sesión medida, de más reciente a más antiguo. */
  days: StatsDay[];
  /** Segundos medidos por juego y año de inicio — cualquier sesión (las horas de un año). */
  gameYearSeconds: { gameId: GameId<Id>; year: number; seconds: number }[];
  /** Segundos medidos por playthrough — cualquier sesión. */
  iterationSeconds: { iterationId: IterationId<Id>; seconds: number }[];
  /** Duración de las medidas y cerradas de toda la historia. */
  lengthAll: SessionLengthSummary;
  /** Y de cada año con alguna. */
  lengthByYear: (SessionLengthSummary & { year: number })[];
  /** La sesión medida y cerrada más larga de toda la historia y de cada año. */
  longestAll: LongestSession | null;
  longestByYear: (LongestSession & { year: number })[];
  /** Toda la biblioteca, sin distinguir medidas de manuales (comparativas de GameStats). */
  library: { sessionCount: number; closedCount: number; closedSeconds: number };
  /** Primera sesión (ms) y segundos de las que arrancaron en los últimos 90 días hasta `now`. */
  pace: { firstSessionAt: number | null; recentSeconds: number };
  /** Qué se jugaba justo antes de estrenar cada juego (modo ambiente). */
  playedJustBefore: { gameId: GameId<Id>; title: string }[];
};

const median = (sorted: readonly number[]): number => {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const summarizeLengths = (durations: number[]): SessionLengthSummary => {
  const counts = Array.from({ length: SESSION_LENGTH_LIMITS_SEC.length + 1 }, () => 0);
  for (const seconds of durations) counts[sessionLengthBucket(seconds)] += 1;
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    counts,
    total: durations.length,
    medianSec: median(sorted),
    longestSec: sorted.at(-1) ?? 0,
    underHour: sorted.filter((seconds) => seconds < 3600).length,
  };
};

/** Reduce las sesiones (más reciente primero) al resumen de las estadísticas. */
export const buildSessionStats = <Id extends EntityIdLike>(
  rows: readonly StatsSessionRow<Id>[],
  now: Date,
): SessionStats<Id> => {
  const years = new Set<number>();
  const days = new Map<number, StatsDay>();
  const gameYear = new Map<string, { gameId: GameId<Id>; year: number; seconds: number }>();
  const iterationSeconds = new Map<IterationId<Id>, number>();
  const allDurations: number[] = [];
  const durationsByYear = new Map<number, number[]>();
  let longestAll: LongestSession | null = null;
  const longestByYear = new Map<number, LongestSession>();
  let closedCount = 0;
  let closedSeconds = 0;
  let firstSessionAt: number | null = null;
  let recentSeconds = 0;
  const windowStart = now.getTime() - PACE_WINDOW_DAYS * DAY_MS;

  for (const row of rows) {
    const startedMs = row.startedAt.getTime();
    const seconds = row.durationSec ?? 0;
    years.add(row.startedAt.getFullYear());

    const year = yearOf(row.startedAt);
    const gameYearKey = `${String(row.gameId)}\u0000${year}`;
    const entry = gameYear.get(gameYearKey);
    if (entry) entry.seconds += seconds;
    else gameYear.set(gameYearKey, { gameId: row.gameId, year, seconds });
    iterationSeconds.set(row.iterationId, (iterationSeconds.get(row.iterationId) ?? 0) + seconds);

    if (row.endedAt !== null) {
      closedCount += 1;
      closedSeconds += seconds;
    }
    if (firstSessionAt === null || startedMs < firstSessionAt) firstSessionAt = startedMs;
    if (startedMs >= windowStart) recentSeconds += seconds;

    if (!isMeasuredSession(row)) continue;
    const dayMs = startOfDayMs(row.startedAt);
    const day = days.get(dayMs) ?? { dayMs, opened: 0, closed: 0, seconds: 0 };
    day.opened += 1;
    if (row.endedAt !== null) {
      day.closed += 1;
      day.seconds += seconds;
    }
    days.set(dayMs, day);

    if (!hasMeasuredDuration(row)) continue;
    allDurations.push(seconds);
    const yearList = durationsByYear.get(row.startedAt.getFullYear()) ?? [];
    yearList.push(seconds);
    durationsByYear.set(row.startedAt.getFullYear(), yearList);
    // Estricto: ante un empate se queda la que aparece antes (la más reciente).
    if (!longestAll || seconds > longestAll.durationSec) {
      longestAll = { durationSec: seconds, gameTitle: row.gameTitle };
    }
    const longestOfYear = longestByYear.get(row.startedAt.getFullYear());
    if (!longestOfYear || seconds > longestOfYear.durationSec) {
      longestByYear.set(row.startedAt.getFullYear(), {
        durationSec: seconds,
        gameTitle: row.gameTitle,
      });
    }
  }

  // Qué jugabas justo antes de estrenar cada juego: la línea temporal medida
  // en orden cronológico (estable: a igual inicio, el orden de entrada) y, en
  // la primera sesión de cada juego, la última de OTRO juego anterior.
  const chronological = rows
    .filter((row) => !row.isManual)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const playedJustBefore: SessionStats<Id>['playedJustBefore'] = [];
  const seen = new Set<GameId<Id>>();
  for (let position = 0; position < chronological.length; position++) {
    const session = chronological[position];
    if (seen.has(session.gameId)) continue;
    seen.add(session.gameId);
    for (let back = position - 1; back >= 0; back--) {
      if (chronological[back].gameId !== session.gameId) {
        playedJustBefore.push({ gameId: session.gameId, title: chronological[back].gameTitle });
        break;
      }
    }
  }

  return {
    years: [...years].sort((a, b) => b - a),
    days: [...days.values()].sort((a, b) => b.dayMs - a.dayMs),
    gameYearSeconds: [...gameYear.values()],
    iterationSeconds: [...iterationSeconds].map(([iterationId, seconds]) => ({
      iterationId,
      seconds,
    })),
    lengthAll: summarizeLengths(allDurations),
    lengthByYear: [...durationsByYear]
      .sort(([a], [b]) => b - a)
      .map(([year, durations]) => ({ year, ...summarizeLengths(durations) })),
    longestAll,
    longestByYear: [...longestByYear]
      .sort(([a], [b]) => b - a)
      .map(([year, longest]) => ({ year, ...longest })),
    library: { sessionCount: rows.length, closedCount, closedSeconds },
    pace: { firstSessionAt, recentSeconds },
    playedJustBefore,
  };
};

/** El resumen de una biblioteca sin sesiones: lo que se pinta mientras llega el del main. */
export const EMPTY_SESSION_STATS: SessionStats = buildSessionStats([], new Date(0));

// ── Vistas: lo que cada gráfica lee del resumen ────────────────────────────

/** Segundos medidos por juego en un año (las horas manuales se suman fuera). */
export const trackedSecondsByGameInYear = <Id extends EntityIdLike>(
  stats: Pick<SessionStats<Id>, 'gameYearSeconds'>,
  year: number,
): Map<GameId<Id>, number> => {
  const byGame = new Map<GameId<Id>, number>();
  for (const entry of stats.gameYearSeconds) {
    if (entry.year === year)
      byGame.set(entry.gameId, (byGame.get(entry.gameId) ?? 0) + entry.seconds);
  }
  return byGame;
};

/** Los días jugados (medianoche local) — base de las rachas. Cuentan las abiertas. */
export const playedDayKeysOf = (stats: Pick<SessionStats, 'days'>): Set<number> =>
  new Set(stats.days.filter((day) => day.opened > 0).map((day) => day.dayMs));

/** Segundos de sesiones medidas y cerradas por mes (`monthKey`). */
export const secondsByMonthOf = (stats: Pick<SessionStats, 'days'>): Map<number, number> => {
  const byMonth = new Map<number, number>();
  for (const day of stats.days) {
    if (day.closed === 0) continue;
    const key = monthKey(new Date(day.dayMs));
    byMonth.set(key, (byMonth.get(key) ?? 0) + day.seconds);
  }
  return byMonth;
};

/** Segundos por día de la semana (lunes primero) de las medidas y cerradas; un año o todo. */
export const secondsByWeekdayOf = (
  stats: Pick<SessionStats, 'days'>,
  year: number | 'all',
): number[] => {
  const seconds = Array.from({ length: 7 }, () => 0);
  for (const day of stats.days) {
    if (day.closed === 0) continue;
    const date = new Date(day.dayMs);
    if (year !== 'all' && date.getFullYear() !== year) continue;
    seconds[(date.getDay() + 6) % 7] += day.seconds;
  }
  return seconds;
};

/** El día de la semana con más horas (índice, lunes = 0), o null sin sesiones cerradas. */
export const topWeekdayIndexOf = (stats: Pick<SessionStats, 'days'>): number | null => {
  const seconds = secondsByWeekdayOf(stats, 'all');
  const max = Math.max(...seconds);
  return max > 0 ? seconds.indexOf(max) : null;
};

/**
 * Los récords de un periodo — sesión más larga, día más cargado, mes más
 * cargado — sobre las medidas y cerradas. Mismo desempate que
 * `sessionActivity`: gana el primer grupo, que en el orden de siempre es el
 * más reciente.
 */
export const recordsFor = (
  stats: Pick<SessionStats, 'days' | 'longestAll' | 'longestByYear'>,
  year: number | 'all',
): {
  longest: LongestSession | null;
  biggestDay: { dayMs: number; seconds: number } | null;
  busiestMonth: { monthKey: number; seconds: number } | null;
} => {
  const longest =
    year === 'all'
      ? stats.longestAll
      : (stats.longestByYear.find((entry) => entry.year === year) ?? null);

  const secondsByDay = new Map<number, number>();
  const secondsByMonth = new Map<number, number>();
  for (const day of stats.days) {
    if (day.closed === 0) continue;
    const date = new Date(day.dayMs);
    if (year !== 'all' && date.getFullYear() !== year) continue;
    secondsByDay.set(day.dayMs, day.seconds);
    const month = monthKey(date);
    secondsByMonth.set(month, (secondsByMonth.get(month) ?? 0) + day.seconds);
  }
  let biggestDay: { dayMs: number; seconds: number } | null = null;
  for (const [dayMs, seconds] of secondsByDay) {
    if (!biggestDay || seconds > biggestDay.seconds) biggestDay = { dayMs, seconds };
  }
  let busiestMonth: { monthKey: number; seconds: number } | null = null;
  for (const [month, seconds] of secondsByMonth) {
    if (!busiestMonth || seconds > busiestMonth.seconds) {
      busiestMonth = { monthKey: month, seconds };
    }
  }
  return { longest, biggestDay, busiestMonth };
};

/** La distribución de duración de un año, o de toda la historia. */
export const lengthSummaryFor = (
  stats: Pick<SessionStats, 'lengthAll' | 'lengthByYear'>,
  year: number | 'all',
): SessionLengthSummary =>
  year === 'all'
    ? stats.lengthAll
    : (stats.lengthByYear.find((entry) => entry.year === year) ?? summarizeLengths([]));
