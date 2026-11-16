import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DAY_MS, monthKey } from '../../../../../../shared/dateMath';
import {
  hoursByGameFromTrackedSeconds,
  hoursByGameInYear,
} from '../../../../../../shared/domain/hours';
import { buildEntries, summarizeEntry } from '../../../../../../shared/domain/journeyEntries';
import { sessionActivity } from '../../../../../../shared/domain/sessionActivity';
import {
  hasMeasuredDuration,
  isMeasuredSession,
  sessionDurationStats,
} from '../../../../../../shared/domain/sessionMeasure';
import {
  lengthSummaryFor,
  playedDayKeysOf,
  recordsFor,
  secondsByMonthOf,
  secondsByWeekdayOf,
  topWeekdayIndexOf,
  trackedSecondsByGameInYear,
} from '../../../../../../shared/domain/sessionStats';
import {
  currentStreak,
  longestStreak,
  playedDayKeys,
} from '../../../../../../shared/domain/streaks';
import { deriveMoments, momentsBySession } from '../../../../../../shared/memory/moments';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGames } from '../../library';
import { getAllStateEvents } from '../../playthroughs';
import { getAllSessions } from '../../sessions/read';
import { getJourneyEntries, getSessionStats, getSessionsPage } from '..';

// F-41: "ninguna pantalla pide todas las sesiones". Estas cifras las calculaba
// el renderer recorriendo la lista entera de sesiones; ahora las calcula el
// main. Este test es la prueba de que los números NO han cambiado: siembra una
// biblioteca con todo lo que desempata o excluye (sesiones manuales, abiertas,
// de varios años, de la misma duración, de un juego sin jugar) y compara, valor
// a valor, el resumen del main con las fórmulas de antes (el "oráculo"), que
// recorren `getAllSessions` como hacían las pantallas.

const NOW = new Date(2026, 5, 15, 12, 0, 0);
const local = (y: number, m: number, d: number, h = 20, min = 0): Date =>
  new Date(y, m - 1, d, h, min);

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb({ start: NOW.getTime() });
});
afterEach(() => fx.close());

type Seed = { playthroughId: string; startedAt: Date; hours?: number; open?: boolean };

function seedLibrary(): void {
  const hollow = seedGame(fx.ctx, { title: 'Hollow Knight' });
  const celeste = seedGame(fx.ctx, { title: 'Celeste' });
  const hades = seedGame(fx.ctx, { title: 'Hades', planned: true });
  const tunic = seedGame(fx.ctx, { title: 'Tunic' });
  const hollow1 = seedPlaythrough(fx.ctx, { gameId: hollow });
  const hollow2 = seedPlaythrough(fx.ctx, { gameId: hollow });
  const celeste1 = seedPlaythrough(fx.ctx, { gameId: celeste });
  const hades1 = seedPlaythrough(fx.ctx, { gameId: hades });
  const tunic1 = seedPlaythrough(fx.ctx, { gameId: tunic });
  seedStateEvent(fx.ctx, {
    playthroughId: hollow1,
    type: 'started',
    occurredAt: local(2024, 11, 2),
  });
  seedStateEvent(fx.ctx, {
    playthroughId: hollow1,
    type: 'completed',
    occurredAt: local(2025, 1, 9),
  });
  seedStateEvent(fx.ctx, {
    playthroughId: celeste1,
    type: 'started',
    occurredAt: local(2025, 3, 3),
  });

  const closed = (seed: Seed): void => {
    seedSession(fx.ctx, {
      playthroughId: seed.playthroughId,
      startedAt: seed.startedAt,
      endedAt: seed.open ? null : new Date(seed.startedAt.getTime() + (seed.hours ?? 1) * 3600_000),
    });
  };
  // Tres años; varias el mismo día (suman un día), empates exactos de duración
  // (la más larga la decide el orden) y de total entre días.
  closed({ playthroughId: hollow1, startedAt: local(2024, 11, 2), hours: 2 });
  closed({ playthroughId: hollow1, startedAt: local(2024, 11, 3), hours: 3 });
  closed({ playthroughId: hollow1, startedAt: local(2024, 11, 4, 9), hours: 0.4 });
  closed({ playthroughId: hollow1, startedAt: local(2024, 12, 31, 23), hours: 1.5 });
  closed({ playthroughId: hollow1, startedAt: local(2025, 1, 1, 0, 30), hours: 1 });
  closed({ playthroughId: hollow2, startedAt: local(2025, 1, 2), hours: 3 });
  closed({ playthroughId: celeste1, startedAt: local(2025, 3, 3, 10), hours: 1 });
  closed({ playthroughId: celeste1, startedAt: local(2025, 3, 3, 15), hours: 1 });
  closed({ playthroughId: celeste1, startedAt: local(2025, 3, 4), hours: 2 });
  closed({ playthroughId: celeste1, startedAt: local(2025, 9, 20), hours: 5 });
  closed({ playthroughId: tunic1, startedAt: local(2026, 2, 14), hours: 0.25 });
  closed({ playthroughId: tunic1, startedAt: local(2026, 2, 15), hours: 4 });
  closed({ playthroughId: tunic1, startedAt: local(2026, 5, 20), hours: 1.2 });
  closed({ playthroughId: tunic1, startedAt: local(2026, 5, 21), hours: 6 });
  closed({ playthroughId: hades1, startedAt: local(2026, 6, 14), hours: 2 });
  closed({ playthroughId: hollow2, startedAt: local(2026, 6, 15, 8), hours: 1 });
  // Una abierta (pinta el día y no suma duración) y dos manuales (no cuentan en
  // hábitos, sí en horas por año y en la biblioteca).
  closed({ playthroughId: hollow2, startedAt: local(2026, 6, 15, 11), open: true });
  for (const [playthroughId, startedAt] of [
    [hollow1, local(2023, 7, 1, 0)],
    [celeste1, local(2025, 3, 3, 12)],
  ] as const) {
    seedSession(fx.ctx, {
      playthroughId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3 * 3600_000),
      source: 'legacy_manual',
      datePrecision: 'month',
    });
  }
}

const sortedDesc = (values: Iterable<number>): number[] => [...values].sort((a, b) => b - a);

describe('F-41: los agregados del main dan las mismas cifras que el renderer sobre todas las sesiones', () => {
  it('Estadísticas: horas por año, hábitos, rachas, récords, histograma, ritmo, comparativas y "justo antes"', () => {
    seedLibrary();
    const sessions = getAllSessions(fx.ctx);
    const games = getGames(fx.ctx);
    const stats = getSessionStats(fx.ctx, NOW);
    assert.ok(sessions.length >= 18);

    // Años con alguna sesión.
    assert.deepEqual(
      stats.years,
      sortedDesc(new Set(sessions.map((s) => s.startedAt.getFullYear()))),
    );

    // Horas por juego y año (cualquier sesión, más las manuales del año).
    const gameIds = games.map((game) => game.id);
    const manualByGame = new Map(games.map((game) => [game.id, game.manualIterations]));
    for (const year of [2023, 2024, 2025, 2026, 2027]) {
      const old = hoursByGameInYear(gameIds, sessions, manualByGame, year);
      const now = hoursByGameFromTrackedSeconds(
        gameIds,
        trackedSecondsByGameInYear(stats, year),
        manualByGame,
        year,
      );
      assert.deepEqual([...now], [...old], `horas ${year}`);
    }

    // Segundos por playthrough (HLTB) y totales de la biblioteca.
    const byIteration = new Map<string, number>();
    for (const s of sessions) {
      byIteration.set(s.iterationId, (byIteration.get(s.iterationId) ?? 0) + (s.durationSec ?? 0));
    }
    assert.deepEqual(
      new Map(stats.iterationSeconds.map((e) => [e.iterationId, e.seconds])),
      byIteration,
    );
    const closedOnes = sessions.filter((s) => s.endedAt !== null);
    assert.deepEqual(stats.library, {
      sessionCount: sessions.length,
      closedCount: closedOnes.length,
      closedSeconds: closedOnes.reduce((sum, s) => sum + (s.durationSec ?? 0), 0),
    });

    // Rachas.
    const oldKeys = playedDayKeys(sessions);
    const newKeys = playedDayKeysOf(stats);
    assert.deepEqual(newKeys, oldKeys);
    assert.equal(currentStreak(newKeys), currentStreak(oldKeys));
    assert.equal(longestStreak(newKeys), longestStreak(oldKeys));
    for (const year of [2024, 2025, 2026]) {
      assert.equal(longestStreak(newKeys, year), longestStreak(oldKeys, year), `racha ${year}`);
    }

    // Por mes y por día de la semana (solo medidas y cerradas).
    const measuredClosed = sessions.filter(hasMeasuredDuration);
    const byMonth = new Map<number, number>();
    for (const s of measuredClosed) {
      const key = monthKey(s.startedAt);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (s.durationSec ?? 0));
    }
    assert.deepEqual(secondsByMonthOf(stats), byMonth);
    for (const year of ['all', 2024, 2025, 2026] as const) {
      const weekday = Array.from({ length: 7 }, () => 0);
      for (const s of measuredClosed) {
        if (year !== 'all' && s.startedAt.getFullYear() !== year) continue;
        weekday[(s.startedAt.getDay() + 6) % 7] += s.durationSec ?? 0;
      }
      assert.deepEqual(secondsByWeekdayOf(stats, year), weekday, `semana ${year}`);
    }
    const weekdayAll = secondsByWeekdayOf(stats, 'all');
    const top = Math.max(...weekdayAll);
    assert.equal(topWeekdayIndexOf(stats), top > 0 ? weekdayAll.indexOf(top) : null);

    // Récords: sesión más larga, día y mes más cargados.
    for (const year of ['all', 2024, 2025, 2026] as const) {
      const scope = measuredClosed.filter(
        (s) => year === 'all' || s.startedAt.getFullYear() === year,
      );
      const old = sessionActivity(scope);
      const now = recordsFor(stats, year);
      assert.deepEqual(
        now.longest && { durationSec: now.longest.durationSec, gameTitle: now.longest.gameTitle },
        old.longest && {
          durationSec: old.longest.durationSec ?? 0,
          gameTitle: old.longest.gameTitle,
        },
        `más larga ${year}`,
      );
      assert.deepEqual(now.biggestDay, old.biggestDay, `día ${year}`);
      assert.deepEqual(now.busiestMonth, old.busiestMonth, `mes ${year}`);
    }

    // Histograma de duración.
    const limits = [30 * 60, 60 * 60, 2 * 3600, 4 * 3600, Infinity];
    for (const year of ['all', 2024, 2025, 2026] as const) {
      const counts = limits.map(() => 0);
      const durations: number[] = [];
      for (const s of sessions) {
        if (!hasMeasuredDuration(s)) continue;
        if (year !== 'all' && s.startedAt.getFullYear() !== year) continue;
        const seconds = s.durationSec ?? 0;
        durations.push(seconds);
        counts[limits.findIndex((limit) => seconds < limit)] += 1;
      }
      durations.sort((a, b) => a - b);
      const middle = Math.floor(durations.length / 2);
      const median =
        durations.length === 0
          ? 0
          : durations.length % 2 === 0
            ? (durations[middle - 1] + durations[middle]) / 2
            : durations[middle];
      assert.deepEqual(
        (({ counts, total, medianSec, longestSec, underHour }) => ({
          counts,
          total,
          medianSec,
          longestSec,
          underHour,
        }))(lengthSummaryFor(stats, year)),
        {
          counts,
          total: durations.length,
          medianSec: median,
          longestSec: durations.at(-1) ?? 0,
          underHour: durations.filter((seconds) => seconds < 3600).length,
        },
        `histograma ${year}`,
      );
    }

    // Ritmo del backlog: primera sesión y segundos de los últimos 90 días.
    const windowStart = NOW.getTime() - 90 * DAY_MS;
    assert.deepEqual(stats.pace, {
      firstSessionAt: Math.min(...sessions.map((s) => s.startedAt.getTime())),
      recentSeconds: sessions
        .filter((s) => s.startedAt.getTime() >= windowStart)
        .reduce((sum, s) => sum + (s.durationSec ?? 0), 0),
    });

    // Modo ambiente: qué se jugaba justo antes de estrenar cada juego.
    const chronological = sessions
      .filter((s) => !s.isManual)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const previous = new Map<string, string>();
    const seen = new Set<string>();
    for (let position = 0; position < chronological.length; position++) {
      const session = chronological[position];
      if (seen.has(session.gameId)) continue;
      seen.add(session.gameId);
      for (let back = position - 1; back >= 0; back--) {
        if (chronological[back].gameId !== session.gameId) {
          previous.set(session.gameId, chronological[back].gameTitle);
          break;
        }
      }
    }
    assert.deepEqual(new Map(stats.playedJustBefore.map((e) => [e.gameId, e.title])), previous);
    assert.ok(previous.size > 0);
    assert.ok(sessions.some((s) => isMeasuredSession(s) && s.endedAt === null));
  });

  it('Sesiones: la página, el total, la más larga, la media y los momentos son los de la lista entera', () => {
    seedLibrary();
    const all = getAllSessions(fx.ctx);
    const games = getGames(fx.ctx);
    const manualHoursByGame = new Map(
      games.map((game) => [game.id, game.manualIterations.reduce((sum, m) => sum + m.hours, 0)]),
    );
    const celesteId = games.find((game) => game.title === 'Celeste')?.id ?? '';
    const oldMoments = momentsBySession(deriveMoments(all, manualHoursByGame));
    for (const gameId of [null, celesteId]) {
      const scope = gameId === null ? all : all.filter((s) => s.gameId === gameId);
      const pageSize = 4;
      const pages = Math.ceil(scope.length / pageSize);
      const oldStats = sessionDurationStats(scope);
      for (let page = 1; page <= pages; page++) {
        const result = getSessionsPage(fx.ctx, { gameId, page, pageSize });
        const expected = scope.slice((page - 1) * pageSize, page * pageSize);
        assert.deepEqual(
          result.items.map((s) => s.id),
          expected.map((s) => s.id),
        );
        assert.equal(result.total, scope.length);
        assert.equal(result.longestSec, oldStats.longestSec);
        assert.equal(result.avgSec, oldStats.avgSec);
        const gotMoments = momentsBySession(result.moments);
        for (const s of expected) {
          assert.deepEqual(gotMoments.get(s.id), oldMoments.get(s.id), `momentos de ${s.id}`);
        }
      }
    }
  });

  it('Journey: las carátulas son las de buildEntries sin sus sesiones, con el mismo recuento', () => {
    seedLibrary();
    const full = buildEntries(getGames(fx.ctx), getAllSessions(fx.ctx), getAllStateEvents(fx.ctx));
    const summaries = getJourneyEntries(fx.ctx);
    assert.ok(full.length > 0);
    assert.deepEqual(summaries, full.map(summarizeEntry));
    assert.deepEqual(
      summaries.map((entry) => entry.sessionCount),
      full.map((entry) => entry.sessions.length),
    );
    for (const entry of summaries) assert.ok(!('sessions' in entry));
  });
});
