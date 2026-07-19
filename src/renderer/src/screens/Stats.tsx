import { Clock, DollarSign, Gamepad2, Gauge } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { BacklogFlowChart } from '../components/stats/BacklogFlowChart';
import { CompletedGallery } from '../components/stats/CompletedGallery';
import { GameAgeDonut } from '../components/stats/GameAgeDonut';
import { GenreRadar } from '../components/stats/GenreRadar';
import { HltbCompareList } from '../components/stats/HltbCompareList';
import { HoursByMonthChart } from '../components/stats/HoursByMonthChart';
import { MostPlayedList } from '../components/stats/MostPlayedList';
import { SessionLengthHistogram } from '../components/stats/SessionLengthHistogram';
import { SpendByMonthChart } from '../components/stats/SpendByMonthChart';
import { StatusBreakdown } from '../components/stats/StatusBreakdown';
import { StreakCard } from '../components/stats/StreakCard';
import { WhenDoYouPlayChart } from '../components/stats/WhenDoYouPlayChart';
import { YearOverYearCompare } from '../components/stats/YearOverYearCompare';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { useGames, usePlannedGames } from '../hooks/games';
import { useAllSessions } from '../hooks/sessions';
import { useAllSpendEvents } from '../hooks/spend';
import { useAllStateEvents } from '../hooks/stateEvents';
import { useCountUp } from '../hooks/useCountUp';
import { yearsDesc } from '../lib/dateMath';
import { formatHours, formatMoney } from '../lib/format';
import { mapGenreToAxis } from '../lib/genreAxes';
import { revealClass, revealStyle } from '../lib/styles';
import { GameStats } from './GameStats';

// Bloque 5B/5C/5D/5E — panel global de Stats: 4 métricas + año activo,
// heatmap de actividad, Most/Top Played, Status Breakdown y Genre Radar.
// Filtrar a un juego concreto (columna de nav) lleva a GameStats.tsx, un
// panel bastante distinto — este archivo solo decide cuál de los dos tocan.
export const Stats = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const selectedGameId = gameParam ? Number(gameParam) : null;

  const [selectedYear, setSelectedYear] = useState<Year>('all');

  const { data: games = [] } = useGames();
  // Solo para la línea "Plan to play" del Backlog flow — el resto de Stats
  // sigue siendo territorio exclusivo de la biblioteca real.
  const { data: plannedGames = [] } = usePlannedGames();
  const { data: sessions = [] } = useAllSessions();
  const { data: spendEvents = [] } = useAllSpendEvents();
  const { data: stateEvents = [] } = useAllStateEvents();

  // El selector de año ofrece cualquier año con ACTIVIDAD de cualquier tipo:
  // sesiones, gastos, cambios de estado (un Beaten de 2019 registrado a mano
  // debe hacer aparecer 2019 aunque no haya sesiones trackeadas), y los años
  // de atribución de horas manuales (ver manualIterations en getGames.ts).
  const years = useMemo(
    () =>
      yearsDesc([
        ...sessions.map((session) => session.startedAt),
        ...spendEvents.map((event) => event.occurredAt),
        ...stateEvents.map((event) => event.occurredAt),
        ...games.flatMap((game) =>
          game.manualIterations.flatMap((manual) =>
            manual.year !== null ? [new Date(manual.year, 6, 1)] : [],
          ),
        ),
      ]),
    [sessions, spendEvents, stateEvents, games],
  );

  // Playthroughs con horas manuales: sus sesiones trackeadas NO cuentan para
  // las horas (manual reemplaza a trackeado, misma regla que
  // resolveIterationHours en el main) — se excluyen del conteo por año.
  const manualIterationIds = useMemo(
    () =>
      new Set(games.flatMap((game) => game.manualIterations.map((manual) => manual.iterationId))),
    [games],
  );

  const trackedSecondsByGameInYear = useMemo(() => {
    if (selectedYear === 'all') return null;
    const map = new Map<number, number>();
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== selectedYear) continue;
      if (manualIterationIds.has(session.iterationId)) continue;
      map.set(session.gameId, (map.get(session.gameId) ?? 0) + (session.durationSec ?? 0));
    }
    return map;
  }, [sessions, selectedYear, manualIterationIds]);

  // Horas por juego para EL AÑO ACTIVO — base compartida de Most Played,
  // Genre Radar y el donut de edad. "All Time" usa game.totalHours (misma
  // fuente que Library/detalle, incluye manualTotalPlayed); un año concreto
  // suma las sesiones reales con fecha de ese año MÁS las horas manuales
  // atribuidas a ese año (por la fecha de fin de su playthrough) — sin esa
  // segunda parte, un playthrough de 200h terminado en 2019 aportaba 0h a la
  // vista de 2019 aunque su Beaten sí saliera en el desglose de estados.
  const hoursByGame = useMemo(() => {
    const map = new Map<number, number>();
    for (const game of games) {
      if (selectedYear === 'all') {
        map.set(game.id, game.totalHours);
        continue;
      }
      const trackedHours = (trackedSecondsByGameInYear?.get(game.id) ?? 0) / 3600;
      const manualHours = game.manualIterations
        .filter((manual) => manual.year === selectedYear)
        .reduce((sum, manual) => sum + manual.hours, 0);
      map.set(game.id, trackedHours + manualHours);
    }
    return map;
  }, [games, selectedYear, trackedSecondsByGameInYear]);

  const totalGames =
    selectedYear === 'all'
      ? games.length
      : games.filter((game) => (hoursByGame.get(game.id) ?? 0) > 0).length;

  const totalHours = [...hoursByGame.values()].reduce((sum, hours) => sum + hours, 0);

  const totalSpent =
    selectedYear === 'all'
      ? spendEvents.reduce((sum, event) => sum + event.amount, 0)
      : spendEvents
          .filter((event) => event.occurredAt.getFullYear() === selectedYear)
          .reduce((sum, event) => sum + event.amount, 0);

  const costPerHour = totalHours > 0 ? totalSpent / totalHours : null;

  const gamesLabel = selectedYear === 'all' ? 'GAMES TRACKED' : 'GAMES PLAYED';
  const spentLabel = selectedYear === 'all' ? 'TOTAL SPENT' : `SPENT IN ${selectedYear}`;

  // Comparación con el año anterior (solo tiene sentido con un año concreto
  // filtrado — "All Time" no tiene un "año pasado"). Mismo cálculo que
  // arriba (hoursByGame/totalGames/totalHours/totalSpent/costPerHour) pero
  // fijado al año-1, en vez de reactivo al selector.
  const previousYear = selectedYear === 'all' ? null : selectedYear - 1;
  const previousYearStats = useMemo(() => {
    if (previousYear === null) return null;

    const trackedSecondsByGamePrev = new Map<number, number>();
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== previousYear) continue;
      if (manualIterationIds.has(session.iterationId)) continue;
      trackedSecondsByGamePrev.set(
        session.gameId,
        (trackedSecondsByGamePrev.get(session.gameId) ?? 0) + (session.durationSec ?? 0),
      );
    }

    const hoursByGamePrev = new Map<number, number>();
    for (const game of games) {
      const trackedHours = (trackedSecondsByGamePrev.get(game.id) ?? 0) / 3600;
      const manualHours = game.manualIterations
        .filter((manual) => manual.year === previousYear)
        .reduce((sum, manual) => sum + manual.hours, 0);
      hoursByGamePrev.set(game.id, trackedHours + manualHours);
    }

    const totalGamesPrev = games.filter((game) => (hoursByGamePrev.get(game.id) ?? 0) > 0).length;
    const totalHoursPrev = [...hoursByGamePrev.values()].reduce((sum, hours) => sum + hours, 0);
    const totalSpentPrev = spendEvents
      .filter((event) => event.occurredAt.getFullYear() === previousYear)
      .reduce((sum, event) => sum + event.amount, 0);
    const costPerHourPrev = totalHoursPrev > 0 ? totalSpentPrev / totalHoursPrev : null;

    return {
      totalGames: totalGamesPrev,
      totalHours: totalHoursPrev,
      totalSpent: totalSpentPrev,
      costPerHour: costPerHourPrev,
    };
  }, [previousYear, games, sessions, spendEvents, manualIterationIds]);

  // Solo se enseña si ese año anterior tiene ALGUNA actividad registrada —
  // comparar contra un año vacío saldría siempre "todo menos", ruido sin
  // información real (ej. el primer año que usas la app).
  const showYearCompare =
    previousYear !== null && previousYearStats !== null && years.includes(previousYear);

  // Contadores animados de las 4 métricas — mismo count-up que las stats de
  // un juego; al cambiar el filtro de año vuelven a subir hacia el valor
  // nuevo (el target cambia y el hook re-anima).
  const animatedGames = useCountUp(totalGames);
  const animatedHours = useCountUp(totalHours);
  const animatedSpent = useCountUp(totalSpent);
  const animatedCost = useCountUp(costPerHour ?? 0);

  const playedEntries = useMemo(
    () =>
      games.map((game) => ({
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        hours: hoursByGame.get(game.id) ?? 0,
      })),
    [games, hoursByGame],
  );

  // Donut de edad de juegos — misma base year-aware (hoursByGame) que
  // Most/Top Played y Genre Radar.
  const ageEntries = useMemo(
    () =>
      games.map((game) => ({
        hours: hoursByGame.get(game.id) ?? 0,
        releaseYear: game.releaseYear,
      })),
    [games, hoursByGame],
  );

  // Genre Radar — cada juego cuenta para el eje de su género principal
  // (genres[0]), con las horas del año activo. Respeta el filtro de año
  // porque usa hoursByGame, que ya lo respeta. Juegos sin género reconocido
  // (mapGenreToAxis devuelve null) no cuentan para ningún eje.
  const minutesByAxis = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const game of games) {
      const axis = mapGenreToAxis(game.genres?.[0] ?? null);
      if (axis === null) continue;
      const hours = hoursByGame.get(game.id) ?? 0;
      totals[axis] = (totals[axis] ?? 0) + hours * 60;
    }
    return totals;
  }, [games, hoursByGame]);

  if (selectedGameId !== null) {
    return (
      <GameStats
        gameId={selectedGameId}
        onOpenGame={() => navigate(`/games/${selectedGameId}`)}
        onClearFilter={() => navigate('/stats')}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      {/* key por año: cambiar el filtro remonta el árbol — la cascada de
          entrada y los contadores vuelven a animar con los datos nuevos. */}
      <div key={String(selectedYear)} className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              All games
            </h1>
            <p className="mt-1.25 text-[13.5px] text-muted-foreground">
              Library-wide overview · select a game on the left for its own stats
            </p>
          </div>

          <YearPicker years={years} value={selectedYear} onChange={setSelectedYear} />
        </div>

        <div
          className={`grid grid-cols-2 gap-3.5 sm:grid-cols-4 ${revealClass}`}
          style={revealStyle(0)}
        >
          <MetricCard
            Icon={Gamepad2}
            label={gamesLabel}
            value={String(Math.round(animatedGames))}
            accent="#85a3d6"
          />
          <MetricCard
            Icon={Clock}
            label="TOTAL PLAYTIME"
            value={formatHours(animatedHours)}
            accent="#2fdc7e"
          />
          <MetricCard
            Icon={DollarSign}
            label={spentLabel}
            value={formatMoney(animatedSpent)}
            accent="#e3b24a"
          />
          <MetricCard
            Icon={Gauge}
            label="AVG COST / HOUR"
            value={costPerHour !== null ? formatMoney(animatedCost) : '—'}
            accent="#7c86c8"
          />
        </div>

        {showYearCompare && previousYear !== null && previousYearStats !== null && (
          <div className={revealClass} style={revealStyle(1)}>
            <YearOverYearCompare
              current={{ totalGames, totalHours, totalSpent, costPerHour }}
              previous={previousYearStats}
              previousYear={previousYear}
            />
          </div>
        )}

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(2)}>
          <ActivityHeatmap sessions={sessions} year={selectedYear} />
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(3)}
        >
          <HoursByMonthChart sessions={sessions} year={selectedYear} />
          <StreakCard sessions={sessions} year={selectedYear} />
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(4)}
        >
          <SpendByMonthChart spendEvents={spendEvents} year={selectedYear} />
          <WhenDoYouPlayChart sessions={sessions} year={selectedYear} />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(5)}>
          <MostPlayedList entries={playedEntries} />
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(6)}
        >
          {selectedYear === 'all' ? (
            <StatusBreakdown mode="all-time" games={games} />
          ) : (
            <StatusBreakdown mode="year" stateEvents={stateEvents} year={selectedYear} />
          )}
          <GenreRadar minutesByAxis={minutesByAxis} />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(7)}>
          <CompletedGallery
            stateEvents={stateEvents}
            games={games}
            year={selectedYear}
            onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
          />
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(8)}
        >
          <HltbCompareList
            games={games}
            stateEvents={stateEvents}
            sessions={sessions}
            year={selectedYear}
          />
          <SessionLengthHistogram sessions={sessions} year={selectedYear} />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(9)}>
          <BacklogFlowChart
            games={games}
            plannedGames={plannedGames}
            stateEvents={stateEvents}
            year={selectedYear}
          />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(10)}>
          <GameAgeDonut entries={ageEntries} year={selectedYear} />
        </div>
      </div>
    </div>
  );
};
