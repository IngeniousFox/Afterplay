import { BarChart3, Clock, DollarSign, Gamepad2, Gauge, Route } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { AchievementsShowcase } from '../components/stats/AchievementsShowcase';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { BacklogDebtCard } from '../components/stats/BacklogDebtCard';
import { BacklogFlowChart } from '../components/stats/BacklogFlowChart';
import { Journey } from '../components/stats/Journey';
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
import { useSessions } from '../hooks/sessions';
import { useSpendEvents } from '../hooks/spend';
import { useStateEvents } from '../hooks/stateEvents';
import { useCountUp } from '../hooks/useCountUp';
import { yearsDesc } from '../lib/dateMath';
import { formatHours, formatMoney } from '../lib/format';
import { mapGenreToAxis } from '../lib/genreAxes';
import { yearTotals } from '../lib/statsTotals';
import { revealClass, revealStyle } from '../lib/styles';
import { GameStats } from './GameStats';

// (yearTotals se mudó a lib/statsTotals.ts: es LA regla de las cifras y ahora
// la comparten esta pantalla y la del modo TV — dos sitios pintando el mismo
// número no pueden calcularlo cada uno por su cuenta.)

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
  const [view, setView] = useState<'overview' | 'journey'>('overview');
  // El toast de "Your June story is ready" llega con /stats?view=journey (y
  // un ?month= que consume el propio Journey). El parámetro solo EMPUJA a la
  // pestaña al aparecer — mismo patrón de "ajustar estado durante el render"
  // que el reset de página de Sessions: el Journey lo borra de la URL después
  // y la pestaña se queda donde estaba, como si la hubieras pulsado tú.
  const viewParam = searchParams.get('view');
  const [seenViewParam, setSeenViewParam] = useState<string | null>(null);
  if (viewParam !== seenViewParam) {
    setSeenViewParam(viewParam);
    if (viewParam === 'journey') setView('journey');
  }

  const { data: games = [] } = useGames();
  // Solo para la línea "Plan to play" del Backlog flow — el resto de Stats
  // sigue siendo territorio exclusivo de la biblioteca real.
  const { data: plannedGames = [] } = usePlannedGames();
  const { data: sessions = [] } = useSessions();
  const { data: spendEvents = [] } = useSpendEvents();
  const { data: stateEvents = [] } = useStateEvents();

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
  // Las 4 métricas de cabecera + su base de horas por juego, para el año
  // elegido. Las mismas cifras se calculan otra vez para el año ANTERIOR
  // (la comparativa de abajo), y tenerlo en una función en vez de dos bloques
  // gemelos evita lo de siempre: arreglar la regla de horas en uno y dejar el
  // otro con la vieja.
  const stats = useMemo(
    () => yearTotals(games, sessions, spendEvents, selectedYear),
    [games, sessions, spendEvents, selectedYear],
  );
  const { hoursByGame, totalGames, totalHours, totalSpent, costPerHour } = stats;

  const gamesLabel = selectedYear === 'all' ? 'GAMES TRACKED' : 'GAMES PLAYED';
  const spentLabel = selectedYear === 'all' ? 'TOTAL SPENT' : `SPENT IN ${selectedYear}`;

  // Comparación con el año anterior — solo tiene sentido con un año concreto
  // filtrado: "All Time" no tiene un "año pasado" contra el que compararse.
  const previousYear = selectedYear === 'all' ? null : selectedYear - 1;
  const previousYearStats = useMemo(
    () => (previousYear === null ? null : yearTotals(games, sessions, spendEvents, previousYear)),
    [previousYear, games, sessions, spendEvents],
  );

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
      <div
        key={view === 'overview' ? `${view}-${String(selectedYear)}` : view}
        className="mx-auto max-w-250"
      >
        <div className="mb-6.5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              {view === 'overview' ? 'All games' : 'Your gaming journey'}
            </h1>
            <p className="mt-1.25 text-[13.5px] text-muted-foreground">
              {view === 'overview'
                ? 'Library-wide overview · select a game on the left for its own stats'
                : 'The games you played, the paths you took, and the ones you returned to'}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex rounded-[10px] border border-input bg-white/[0.025] p-1">
              <button
                type="button"
                onClick={() => setView('overview')}
                className="flex items-center gap-1.75 rounded-[7px] px-3 py-1.75 text-[12px] font-bold transition-[background-color,color,box-shadow] duration-150"
                style={
                  view === 'overview'
                    ? {
                        background: 'rgba(47,220,126,.12)',
                        color: '#2fdc7e',
                        boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.32)',
                      }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                <BarChart3 size={13} />
                Overview
              </button>
              <button
                type="button"
                onClick={() => setView('journey')}
                className="flex items-center gap-1.75 rounded-[7px] px-3 py-1.75 text-[12px] font-bold transition-[background-color,color,box-shadow] duration-150"
                style={
                  view === 'journey'
                    ? {
                        background: 'rgba(133,163,214,.13)',
                        color: '#85a3d6',
                        boxShadow: 'inset 0 0 0 1px rgba(133,163,214,.34)',
                      }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                <Route size={13} />
                Journey
              </button>
            </div>

            {view === 'overview' && (
              <YearPicker years={years} value={selectedYear} onChange={setSelectedYear} />
            )}
          </div>
        </div>

        {view === 'journey' ? (
          <Journey
            games={games}
            sessions={sessions}
            stateEvents={stateEvents}
            onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
          />
        ) : (
          <>
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

            {/* El bloque de trofeos (LOGROS-IDEAS.md), año-consciente: con un
                año elegido enseña la fama, la rareza y los 100% DE ese año;
                lo que es foto de ahora (almost there, gráfica de años) solo
                sale en All Time. */}
            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(8)}>
              <AchievementsShowcase
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

            {/* Los dos van a lo ANCHO, uno encima del otro: el flujo es una línea
            temporal de meses y en media columna la línea se aplasta hasta no
            leerse, y la deuda es una cifra sola que a lo ancho se lee mejor
            en banda que en columna alta. */}
            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(9)}>
              <BacklogFlowChart
                games={games}
                plannedGames={plannedGames}
                stateEvents={stateEvents}
                year={selectedYear}
              />
            </div>

            {/* Dos preguntas distintas según el filtro, como StatusBreakdown:
            All Time es el BALANCE (lo que debes y a qué ritmo vas) y un año
            concreto es su MOVIMIENTO (qué asumiste, qué liquidaste, neto). */}
            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(10)}>
              {selectedYear === 'all' ? (
                <BacklogDebtCard
                  mode="all-time"
                  games={games}
                  plannedGames={plannedGames}
                  sessions={sessions}
                />
              ) : (
                <BacklogDebtCard
                  mode="year"
                  games={games}
                  plannedGames={plannedGames}
                  stateEvents={stateEvents}
                  year={selectedYear}
                />
              )}
            </div>

            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(11)}>
              <GameAgeDonut entries={ageEntries} year={selectedYear} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
