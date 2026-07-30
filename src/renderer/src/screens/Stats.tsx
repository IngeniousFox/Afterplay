import { BarChart3, Clock, DollarSign, Gamepad2, Gauge, Route } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GameListItem, SessionWithGame, SpendEventSummary } from '../../../shared/types';
import { MetricCard } from '../components/library/detail/MetricsRow';
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
import { revealClass, revealStyle } from '../lib/styles';
import { GameStats } from './GameStats';

// Las cifras de cabecera de un año (o de toda la vida), y el reparto de horas
// por juego del que salen. Función suelta y no hook: la pantalla la llama dos
// veces, una para el año elegido y otra para el anterior, y así las dos
// comparten literalmente la misma regla.
//
// Horas de un juego:
//   · "All Time" -> game.totalHours, la misma fuente que Library y la ficha.
//   · Un año concreto -> las sesiones fechadas ESE año MÁS las horas manuales
//     atribuidas a él (por la fecha de fin de su playthrough, ver
//     manualHoursAnchor). Sin esa segunda parte, un playthrough de 200h
//     terminado en 2019 aportaba 0h a la vista de 2019 aunque su Beaten sí
//     saliera en el desglose de estados.
//
// SUMA las dos partes, igual que resolveIterationHours en el main: las horas
// manuales son lo jugado FUERA del tracking, así que un playthrough con horas
// manuales al que además le cuelgan sesiones aporta ambas.
const yearTotals = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  spendEvents: SpendEventSummary[],
  year: Year,
): {
  hoursByGame: Map<number, number>;
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
} => {
  const trackedSecondsByGame = new Map<number, number>();
  if (year !== 'all') {
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== year) continue;
      const current = trackedSecondsByGame.get(session.gameId) ?? 0;
      trackedSecondsByGame.set(session.gameId, current + (session.durationSec ?? 0));
    }
  }

  const hoursByGame = new Map<number, number>();
  for (const game of games) {
    if (year === 'all') {
      hoursByGame.set(game.id, game.totalHours);
      continue;
    }
    const trackedHours = (trackedSecondsByGame.get(game.id) ?? 0) / 3600;
    const manualHours = game.manualIterations
      .filter((manual) => manual.year === year)
      .reduce((sum, manual) => sum + manual.hours, 0);
    hoursByGame.set(game.id, trackedHours + manualHours);
  }

  // "All Time" cuenta la biblioteca entera; un año concreto, solo los juegos
  // que de verdad se tocaron ese año (de ahí las dos etiquetas distintas del
  // contador: GAMES TRACKED vs GAMES PLAYED).
  const totalGames =
    year === 'all'
      ? games.length
      : games.filter((game) => (hoursByGame.get(game.id) ?? 0) > 0).length;

  const totalHours = [...hoursByGame.values()].reduce((sum, hours) => sum + hours, 0);
  const totalSpent = spendEvents
    .filter((event) => year === 'all' || event.occurredAt.getFullYear() === year)
    .reduce((sum, event) => sum + event.amount, 0);

  return {
    hoursByGame,
    totalGames,
    totalHours,
    totalSpent,
    costPerHour: totalHours > 0 ? totalSpent / totalHours : null,
  };
};

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

            {/* La deuda es una foto de AHORA (lo que te queda y a qué ritmo vas),
            así que no tiene lectura por año: con un año filtrado no se pinta. */}
            {selectedYear === 'all' && (
              <div className={`mt-4.5 ${revealClass}`} style={revealStyle(10)}>
                <BacklogDebtCard games={games} plannedGames={plannedGames} sessions={sessions} />
              </div>
            )}

            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(11)}>
              <GameAgeDonut entries={ageEntries} year={selectedYear} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
