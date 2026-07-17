import { Clock, DollarSign, Gamepad2, Gauge } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { GameAgeDonut } from '../components/stats/GameAgeDonut';
import { GenreRadar } from '../components/stats/GenreRadar';
import { HoursByMonthChart } from '../components/stats/HoursByMonthChart';
import { MostPlayedList } from '../components/stats/MostPlayedList';
import { StatusBreakdown } from '../components/stats/StatusBreakdown';
import { StreakCard } from '../components/stats/StreakCard';
import { TopPlayedList } from '../components/stats/TopPlayedList';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { useGames } from '../hooks/games';
import { useAllSessions } from '../hooks/sessions';
import { useAllSpendEvents } from '../hooks/spend';
import { useAllStateEvents } from '../hooks/stateEvents';
import { yearsDesc } from '../lib/dateMath';
import { formatHours, formatMoney } from '../lib/format';
import { mapGenreToAxis } from '../lib/genreAxes';
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
  const { data: sessions = [] } = useAllSessions();
  const { data: spendEvents = [] } = useAllSpendEvents();
  const { data: stateEvents = [] } = useAllStateEvents();

  const years = useMemo(
    () =>
      yearsDesc([
        ...sessions.map((session) => session.startedAt),
        ...spendEvents.map((event) => event.occurredAt),
      ]),
    [sessions, spendEvents],
  );

  const trackedSecondsByGameInYear = useMemo(() => {
    if (selectedYear === 'all') return null;
    const map = new Map<number, number>();
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== selectedYear) continue;
      map.set(session.gameId, (map.get(session.gameId) ?? 0) + (session.durationSec ?? 0));
    }
    return map;
  }, [sessions, selectedYear]);

  // Horas por juego para EL AÑO ACTIVO — base compartida de Most/Top Played
  // y Genre Radar. "All Time" usa game.totalHours (misma fuente que
  // Library/detalle, incluye manualTotalPlayed); un año concreto solo puede
  // venir de sesiones reales con fecha (mismo motivo que el resto de Stats:
  // ver el comentario de más abajo sobre por qué no hay atajo mejor).
  const hoursByGame = useMemo(() => {
    const map = new Map<number, number>();
    for (const game of games) {
      const hours =
        selectedYear === 'all'
          ? game.totalHours
          : (trackedSecondsByGameInYear?.get(game.id) ?? 0) / 3600;
      map.set(game.id, hours);
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
      <div className="mx-auto max-w-250">
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

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <MetricCard Icon={Gamepad2} label={gamesLabel} value={String(totalGames)} />
          <MetricCard Icon={Clock} label="TOTAL PLAYTIME" value={formatHours(totalHours)} />
          <MetricCard Icon={DollarSign} label={spentLabel} value={formatMoney(totalSpent)} />
          <MetricCard
            Icon={Gauge}
            label="AVG COST / HOUR"
            value={costPerHour !== null ? formatMoney(costPerHour) : '—'}
          />
        </div>

        <div className="mt-4.5">
          <ActivityHeatmap sessions={sessions} year={selectedYear} />
        </div>

        <div className="mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5">
          <HoursByMonthChart sessions={sessions} year={selectedYear} />
          <StreakCard sessions={sessions} year={selectedYear} />
        </div>

        <div className="mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5">
          <MostPlayedList entries={playedEntries} />
          {selectedYear === 'all' ? (
            <StatusBreakdown mode="all-time" games={games} />
          ) : (
            <StatusBreakdown mode="year" stateEvents={stateEvents} year={selectedYear} />
          )}
        </div>

        <div className="mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5">
          <TopPlayedList entries={playedEntries} />
          <GenreRadar minutesByAxis={minutesByAxis} />
        </div>

        <div className="mt-4.5">
          <GameAgeDonut entries={ageEntries} year={selectedYear} />
        </div>
      </div>
    </div>
  );
};
