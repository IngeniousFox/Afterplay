import { cn } from '../lib/utils';
import { BarChart3, Gamepad2, Route } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import {
  YearMetricComparison,
  type YearComparisonBaseline,
} from '../components/stats/YearOverYearCompare';
import type { Year } from '../components/stats/YearPicker';
import { YearTabs } from '../components/stats/YearPicker';
import { GameCover } from '../components/GameCover';
import { useGames, usePlannedGames } from '../hooks/games';
import { useHeatmapSessions } from '../hooks/sessions';
import { useSessionStats } from '../hooks/stats';
import { useSpendEvents } from '../hooks/spend';
import { useStateEvents } from '../hooks/stateEvents';
import { useCountUp } from '../hooks/useCountUp';
import { useImageSrc } from '../hooks/useImageSrc';
import { yearsDesc } from '../lib/dateMath';
import { formatHours, formatMoney } from '../lib/format';
import { mapGenreToAxis } from '../lib/genreAxes';
import { EMPTY_SESSION_STATS, recordsFor } from '../../../shared/domain/sessionStats';
import { yearTotals } from '../lib/statsTotals';
import { revealClass, revealStyle } from '../lib/styles';
import { GameStats } from './GameStats';
import { parseEntityId, type GameId } from '../../../shared/entityIds';

// (yearTotals se mudó a lib/statsTotals.ts: es LA regla de las cifras y ahora
// la comparten esta pantalla y la del modo TV — dos sitios pintando el mismo
// número no pueden calcularlo cada uno por su cuenta.)

type HeadlineGame = {
  id: GameId;
  title: string;
  heroUrl: string | null;
  coverUrl: string | null;
  hours: number;
};

type StatsChapterId = 'pulse' | 'cast' | 'pace' | 'backlog' | 'cabinet';

type StatsRecord = {
  key: string;
  label: string;
  value: string;
  detail: string;
};

// Una duración "179h 38m" en Big Shoulders con las unidades más pequeñas y
// apagadas: la cifra se lee primero, la unidad después.
const UnitFigure = ({
  text,
  unitClassName,
}: {
  text: string;
  unitClassName: string;
}): React.JSX.Element => (
  <>
    {text.split(/([hm])/).map((part, index) =>
      part === 'h' || part === 'm' ? (
        <span key={index} className={unitClassName}>
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      ),
    )}
  </>
);

// Los récords del archivo, en lista junto al líder (stats-overview.png):
// nombre y detalle a la izquierda, la cifra en Big Shoulders a la derecha.
const StatsRecordDeck = ({ records }: { records: StatsRecord[] }): React.JSX.Element => (
  <section className="afterplay-stats-record-deck flex flex-col" aria-label="Archive records">
    {records.map(({ key, label, value, detail }) => (
      <div
        key={key}
        className="afterplay-stats-record-card flex min-w-0 items-center justify-between gap-4 border-t border-line py-2.5"
      >
        <div className="min-w-0">
          <div className="text-body font-semibold text-bone">{label}</div>
          <div className="text-small text-dust">{detail}</div>
        </div>
        <div className="flex-none font-display text-[34px] leading-none font-bold text-bone tabular-nums">
          {value}
        </div>
      </div>
    ))}
  </section>
);

// Una cifra secundaria del hero, sin caja: valor en Big Shoulders, rótulo
// debajo y, con un año elegido, la comparación con el anterior.
const HeroFigure = ({
  label,
  value,
  comparison,
}: {
  label: string;
  value: string;
  comparison?: React.ReactNode;
}): React.JSX.Element => (
  <div className="afterplay-stats-metric min-w-0">
    {/* La estructura rótulo -> valor se mantiene como contrato accesible
        para las pruebas de cifras derivadas. */}
    <div className="text-small text-dust">{label}</div>
    <div className="font-display text-[40px] leading-none font-bold text-bone tabular-nums">
      {value}
    </div>
    {comparison}
  </div>
);

// Las cifras del hero con su contador animado. Componente aparte por
// RENDIMIENTO, no por orden: useCountUp reprinta a 60 fps durante 700 ms (unos
// 42 renders) justo mientras entra la pantalla. El compilador de React
// memoiza POR EXPRESIÓN y toda la rama de overview es una sola expresión, así
// que con los valores animados leídos ahí dentro esos 42 frames reconstruían
// las 18 tarjetas de la página para que subieran cuatro números. Encerrados
// aquí, el árbol de Stats se construye una vez y los frames solo tocan esto.
const HeroFigures = ({
  totalGames,
  totalHours,
  totalSpent,
  costPerHour,
  gamesLabel,
  spentLabel,
  headline,
  supporting,
  periodLabel,
  comparison,
}: {
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
  gamesLabel: string;
  spentLabel: string;
  headline: string;
  supporting: string;
  periodLabel: string;
  comparison?: YearComparisonBaseline;
}): React.JSX.Element => {
  const animatedGames = useCountUp(totalGames);
  const animatedHours = useCountUp(totalHours);
  const animatedSpent = useCountUp(totalSpent);
  const animatedCost = useCountUp(costPerHour ?? 0);

  return (
    <div className="afterplay-stats-records flex min-w-0 flex-col">
      <div className="flex items-center gap-2 text-small text-dust">
        <span className="size-2 rounded-full bg-phosphor shadow-glow-bar" aria-hidden="true" />
        {periodLabel}
      </div>
      <div className="afterplay-stats-metric afterplay-stats-total min-w-0">
        <div className="sr-only">Total playtime</div>
        <div
          className={cn(
            'mt-1 font-display text-[clamp(96px,10vw,164px)] leading-[0.86] font-bold whitespace-nowrap text-phosphor tabular-nums',
            '[text-shadow:0_0_40px_rgb(255_179_71/0.35)]',
          )}
        >
          <UnitFigure
            text={formatHours(animatedHours)}
            unitClassName="mr-[0.12em] text-[0.42em] text-phosphor-lo"
          />
        </div>
        {comparison && (
          <YearMetricComparison
            metric="totalHours"
            current={totalHours}
            previous={comparison.metrics.totalHours}
            previousYear={comparison.year}
          />
        )}
      </div>
      <h2 className="mt-4 text-[26px] leading-tight font-semibold text-bone">{headline}</h2>
      <p className="mt-1 max-w-[640px] text-lead text-dust">{supporting}</p>

      <div className="mt-5 flex flex-wrap gap-x-11 gap-y-4 border-t border-line pt-4">
        <HeroFigure
          label={gamesLabel}
          value={String(Math.round(animatedGames))}
          comparison={
            comparison && (
              <YearMetricComparison
                metric="totalGames"
                current={totalGames}
                previous={comparison.metrics.totalGames}
                previousYear={comparison.year}
              />
            )
          }
        />
        <HeroFigure
          label={spentLabel}
          value={formatMoney(animatedSpent)}
          comparison={
            comparison && (
              <YearMetricComparison
                metric="totalSpent"
                current={totalSpent}
                previous={comparison.metrics.totalSpent}
                previousYear={comparison.year}
              />
            )
          }
        />
        <HeroFigure
          label="Average cost per hour"
          value={costPerHour !== null ? formatMoney(animatedCost) : '—'}
          comparison={
            comparison && (
              <YearMetricComparison
                metric="costPerHour"
                current={costPerHour}
                previous={comparison.metrics.costPerHour}
                previousYear={comparison.year}
              />
            )
          }
        />
      </div>
    </div>
  );
};

// Anillo pequeño con el porcentaje de horas del líder.
const ShareRing = ({ percent }: { percent: number }): React.JSX.Element => {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid size-14 flex-none place-items-center">
      <svg width={56} height={56} viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle
          cx={28}
          cy={28}
          r={radius}
          fill="none"
          stroke="var(--color-raised)"
          strokeWidth={5}
        />
        <circle
          cx={28}
          cy={28}
          r={radius}
          fill="none"
          stroke="var(--color-phosphor)"
          strokeWidth={5}
          strokeDasharray={`${(Math.min(100, percent) / 100) * circumference} ${circumference}`}
        />
      </svg>
      <span className="relative text-small font-semibold text-bone tabular-nums">{percent}%</span>
    </div>
  );
};

const StatsHero = ({
  year,
  totalGames,
  totalHours,
  totalSpent,
  costPerHour,
  gamesLabel,
  spentLabel,
  headlineGame,
  records,
  onOpenGame,
  comparison,
}: {
  year: Year;
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
  gamesLabel: string;
  spentLabel: string;
  headlineGame: HeadlineGame | null;
  records: StatsRecord[];
  onOpenGame: (gameId: GameId) => void;
  comparison?: YearComparisonBaseline;
}): React.JSX.Element => {
  const heroSrc = useImageSrc(headlineGame?.heroUrl ?? null, 'heroes');
  const coverSrc = useImageSrc(headlineGame?.coverUrl ?? null, 'covers');
  const art = heroSrc ?? coverSrc;
  const share = totalHours > 0 && headlineGame ? headlineGame.hours / totalHours : 0;
  const sharePercent = Math.round(share * 100);
  const currentYear = new Date().getFullYear();
  const periodLabel =
    year === 'all'
      ? 'All time, every year you have logged'
      : year === currentYear
        ? `${year}, still being written`
        : `${year}, the whole year`;
  const headline = headlineGame
    ? year === 'all'
      ? `${headlineGame.title} leads your archive.`
      : share >= 0.45
        ? `A deep dive into ${headlineGame.title}.`
        : `${headlineGame.title} set the pace.`
    : 'Your next chapter starts here.';
  const supporting =
    totalHours > 0
      ? `Total playtime across ${totalGames} ${totalGames === 1 ? 'game' : 'games'}.${
          headlineGame ? ` ${headlineGame.title} accounts for ${sharePercent}% of the time.` : ''
        }`
      : 'Playtime will shape this space as soon as Afterplay has something measured.';

  return (
    <section
      className={cn(
        'afterplay-stats-hero relative isolate overflow-hidden rounded-md border border-line bg-panel',
        'grid gap-8 px-9 py-8 min-[1180px]:grid-cols-[minmax(0,1fr)_440px]',
      )}
    >
      {art && (
        <img
          src={art}
          alt=""
          className={cn(
            'afterplay-stats-hero-art absolute inset-y-0 right-0 -z-2 h-full w-[70%] object-cover opacity-28',
            '[mask-image:linear-gradient(90deg,transparent,black_55%)]',
            heroSrc ? '' : 'scale-110 blur-xl',
          )}
        />
      )}
      <span
        className="pointer-events-none absolute inset-0 -z-1 bg-(image:--scan) opacity-60"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-0 -z-1 bg-[radial-gradient(60%_80%_at_12%_100%,rgb(255_179_71/0.14),transparent_70%)]"
        aria-hidden="true"
      />

      <HeroFigures
        totalGames={totalGames}
        totalHours={totalHours}
        totalSpent={totalSpent}
        costPerHour={costPerHour}
        gamesLabel={gamesLabel}
        spentLabel={spentLabel}
        headline={headline}
        supporting={supporting}
        periodLabel={periodLabel}
        comparison={comparison}
      />

      <div className="flex min-w-0 flex-col gap-4">
        {headlineGame ? (
          <button
            type="button"
            onClick={() => onOpenGame(headlineGame.id)}
            className={cn(
              'afterplay-stats-leader flex items-center gap-4 rounded-md border border-line-strong bg-cabinet/70 p-3.5 text-left backdrop-blur-md',
              'transition-[border-color,background-color] duration-150 hover:border-line-hover hover:bg-raised/80',
              'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
            )}
            aria-label={`Open ${headlineGame.title}`}
          >
            <GameCover
              url={headlineGame.coverUrl}
              className="afterplay-stats-leader-cover h-24 w-18 flex-none overflow-hidden rounded-sm border border-line-strong"
              iconSize={22}
            />
            <div className="min-w-0 flex-1">
              <div className="text-small text-dust">Most played</div>
              <div className="line-clamp-2 text-lead font-semibold text-bone">
                {headlineGame.title}
              </div>
              <div className="mt-1 font-display text-[30px] leading-none font-bold text-bone tabular-nums">
                {formatHours(headlineGame.hours)}
              </div>
            </div>
            <ShareRing percent={sharePercent} />
          </button>
        ) : (
          <div className="afterplay-stats-leader flex min-h-30 items-center justify-center rounded-md border border-dashed border-line-strong bg-cabinet/50 p-5 text-center">
            <div>
              <Gamepad2 size={22} className="mx-auto text-dust" />
              <div className="mt-2 text-small text-dust">No leader yet</div>
            </div>
          </div>
        )}
        <StatsRecordDeck records={records} />
      </div>
    </section>
  );
};

const StatsChapterHeading = ({
  id,
  title,
  description,
}: {
  id: StatsChapterId;
  title: string;
  description: string;
}): React.JSX.Element => (
  <div
    id={`stats-${id}`}
    data-stats-chapter={id}
    className="afterplay-stats-chapter-heading mt-12 mb-4 flex scroll-mt-21 flex-wrap items-baseline gap-x-5 gap-y-1"
  >
    <h2 className="font-display text-[34px] leading-none font-bold text-bone">{title}</h2>
    <p className="text-body text-dust">{description}</p>
  </div>
);

const viewButtonClass = (active: boolean): string =>
  cn(
    'afterplay-stats-view-button relative flex h-9 items-center gap-2 px-4 text-body font-semibold',
    'transition-colors duration-150 outline-hidden',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
    'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-phosphor after:transition-opacity',
    active
      ? 'bg-raised text-bone after:opacity-100'
      : 'text-dust after:opacity-0 hover:bg-raised/60 hover:text-bone',
  );

// Bloque 5B/5C/5D/5E — panel global de Stats. Filtrar a un juego concreto
// (?game=, desde Ctrl K) lleva a GameStats.tsx, un panel bastante distinto —
// este archivo solo decide cuál de los dos tocan.
export const Stats = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const selectedGameId = gameParam ? parseEntityId(gameParam) : null;

  const [selectedYear, setSelectedYear] = useState<Year>('all');
  const [view, setView] = useState<'overview' | 'journey'>('overview');
  // Hueco de la cabecera fija donde el Journey pinta sus tres cifras.
  const [journeySlot, setJourneySlot] = useState<HTMLDivElement | null>(null);
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
  // Ninguna sesión suelta (F-41): los agregados los calcula el main, y el
  // heatmap pide solo las de su ventana.
  const { data: sessionStats = EMPTY_SESSION_STATS } = useSessionStats();
  const heatmapSessions = useHeatmapSessions(selectedYear);
  const { data: spendEvents = [] } = useSpendEvents();
  const { data: stateEvents = [] } = useStateEvents();

  // El selector de año ofrece cualquier año con ACTIVIDAD de cualquier tipo:
  // sesiones, gastos, cambios de estado (un Beaten de 2019 registrado a mano
  // debe hacer aparecer 2019 aunque no haya sesiones trackeadas), y los años
  // de atribución de horas manuales (ver manualIterations en getGames.ts).
  const years = useMemo(
    () =>
      yearsDesc([
        ...sessionStats.years.map((year) => new Date(year, 6, 1)),
        ...spendEvents.map((event) => event.occurredAt),
        ...stateEvents.map((event) => event.occurredAt),
        ...games.flatMap((game) =>
          game.manualIterations.flatMap((manual) =>
            manual.year !== null ? [new Date(manual.year, 6, 1)] : [],
          ),
        ),
      ]),
    [sessionStats, spendEvents, stateEvents, games],
  );
  // Las cifras de cabecera + su base de horas por juego, para el año elegido.
  // Las mismas cifras se calculan otra vez para el año ANTERIOR (la
  // comparativa), con la misma función para no divergir.
  const stats = useMemo(
    () => yearTotals(games, sessionStats, spendEvents, selectedYear),
    [games, sessionStats, spendEvents, selectedYear],
  );
  const { hoursByGame, totalGames, totalHours, totalSpent, costPerHour } = stats;

  const gamesLabel = selectedYear === 'all' ? 'Games tracked' : 'Games played';
  const spentLabel = selectedYear === 'all' ? 'Total spent' : `Spent in ${selectedYear}`;

  // Comparación con el año anterior — solo tiene sentido con un año concreto
  // filtrado: "All Time" no tiene un "año pasado" contra el que compararse.
  const previousYear = selectedYear === 'all' ? null : selectedYear - 1;
  const previousYearStats = useMemo(
    () =>
      previousYear === null ? null : yearTotals(games, sessionStats, spendEvents, previousYear),
    [previousYear, games, sessionStats, spendEvents],
  );

  // Solo se enseña si ese año anterior tiene ALGUNA actividad registrada —
  // comparar contra un año vacío saldría siempre "todo menos".
  const showYearCompare =
    previousYear !== null && previousYearStats !== null && years.includes(previousYear);

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

  // El arte y el titular salen del juego que de verdad lidera la ventana
  // elegida. Cero slogans aleatorios: hasta el tono de "deep dive" depende de
  // cuánto del tiempo representa el primero.
  const headlineGame = useMemo<HeadlineGame | null>(() => {
    const leader = playedEntries
      .filter((entry) => entry.hours > 0)
      .sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title))[0];
    if (!leader) return null;
    const game = games.find((candidate) => candidate.id === leader.id);
    if (!game) return null;
    return {
      id: game.id,
      title: game.title,
      heroUrl: game.heroUrl,
      coverUrl: game.coverUrl,
      hours: leader.hours,
    };
  }, [games, playedEntries]);

  const archiveRecords = useMemo<StatsRecord[]>(() => {
    const { longest, biggestDay, busiestMonth } = recordsFor(sessionStats, selectedYear);
    const peakDay = biggestDay ? [biggestDay.dayMs, biggestDay.seconds] : null;
    const peakMonth = busiestMonth ? [busiestMonth.monthKey, busiestMonth.seconds] : null;
    const peakMonthDate = peakMonth
      ? new Date(Math.floor(peakMonth[0] / 12), peakMonth[0] % 12, 1)
      : null;
    const completions = stateEvents.filter(
      (event) =>
        event.type === 'completed' &&
        (selectedYear === 'all' || event.occurredAt.getFullYear() === selectedYear),
    );
    const completedGames = new Set(completions.map((event) => event.gameId));

    return [
      {
        key: 'longest-session',
        label: 'Longest session',
        value: longest ? formatHours((longest.durationSec ?? 0) / 3600) : '—',
        detail: longest?.gameTitle ?? 'No measured session yet',
      },
      {
        key: 'peak-day',
        label: 'Hottest day',
        value: peakDay ? formatHours(peakDay[1] / 3600) : '—',
        detail: peakDay
          ? new Date(peakDay[0]).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : 'No active day yet',
      },
      {
        key: 'peak-month',
        label: 'Peak month',
        value: peakMonth ? formatHours(peakMonth[1] / 3600) : '—',
        detail: peakMonthDate
          ? peakMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          : 'No active month yet',
      },
      {
        key: 'finishes',
        label: 'Finish line',
        value: String(completions.length),
        detail:
          completions.length > 0
            ? `finishes, ${completedGames.size} ${completedGames.size === 1 ? 'game' : 'games'} crossed it`
            : 'No finishes in this period',
      },
    ];
  }, [selectedYear, sessionStats, stateEvents]);

  // Donut de edad de juegos — misma base year-aware (hoursByGame) que
  // Most Played y Genre Radar.
  const ageEntries = useMemo(
    () =>
      games.map((game) => ({
        hours: hoursByGame.get(game.id) ?? 0,
        releaseYear: game.releaseYear,
      })),
    [games, hoursByGame],
  );

  // Genre Radar — cada juego cuenta para el eje de su género principal
  // (genres[0]), con las horas del año activo. Juegos sin género reconocido
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
        onSelectGame={(gameId) => navigate(`/stats?game=${gameId}`)}
      />
    );
  }

  const openGame = (gameId: GameId): void => {
    void navigate(`/games/${gameId}`);
  };

  return (
    <div
      className={cn(
        'afterplay-stats-screen relative isolate h-full overflow-x-hidden overflow-y-auto bg-cabinet',
        'scroll-smooth scroll-pt-21 motion-reduce:scroll-auto',
      )}
    >
      {/* Cabecera fija (68 px): qué vista y qué rango se está leyendo sigue a
          la vista al hacer scroll. */}
      <header
        className={cn(
          'afterplay-stats-topbar sticky top-0 z-20 flex h-17 items-center gap-6 border-b border-line',
          'bg-cabinet/92 px-8 backdrop-blur-md',
        )}
      >
        <h1 className="font-display text-[44px] leading-none font-bold text-bone">Stats</h1>
        <div className="afterplay-stats-view-switch flex overflow-hidden rounded-sm border border-line-strong">
          <button
            type="button"
            aria-pressed={view === 'overview'}
            onClick={() => setView('overview')}
            className={viewButtonClass(view === 'overview')}
          >
            <BarChart3 size={15} />
            Overview
          </button>
          <button
            type="button"
            aria-pressed={view === 'journey'}
            onClick={() => setView('journey')}
            className={cn(viewButtonClass(view === 'journey'), 'border-l border-line-strong')}
          >
            <Route size={15} />
            Journey
          </button>
        </div>
        <div className="ml-auto flex min-w-0 items-center">
          {view === 'overview' ? (
            <YearTabs years={years} value={selectedYear} onChange={setSelectedYear} maxTabs={6} />
          ) : (
            <div ref={setJourneySlot} className="flex items-baseline gap-7" />
          )}
        </div>
      </header>

      {/* key por año: cambiar el filtro remonta el árbol — la cascada de
          entrada y los contadores vuelven a animar con los datos nuevos. */}
      <div
        key={view === 'overview' ? `${view}-${String(selectedYear)}` : view}
        className="relative mx-auto max-w-[1600px] px-8 pt-5 pb-16"
      >
        {view === 'journey' ? (
          <Journey onOpenGame={openGame} headerSlot={journeySlot} />
        ) : (
          <>
            <div className={revealClass} style={revealStyle(0)}>
              <StatsHero
                year={selectedYear}
                totalGames={totalGames}
                totalHours={totalHours}
                totalSpent={totalSpent}
                costPerHour={costPerHour}
                gamesLabel={gamesLabel}
                spentLabel={spentLabel}
                headlineGame={headlineGame}
                records={archiveRecords}
                onOpenGame={openGame}
                comparison={
                  showYearCompare && previousYear !== null && previousYearStats !== null
                    ? { year: previousYear, metrics: previousYearStats }
                    : undefined
                }
              />
            </div>

            <StatsChapterHeading
              id="pulse"
              title="How the time moved"
              description="Days, months and habits: the rhythm underneath the totals."
            />
            <div className={revealClass} style={revealStyle(1)}>
              <ActivityHeatmap sessions={heatmapSessions} year={selectedYear} />
            </div>
            <div
              className={cn(
                'afterplay-stats-split mt-4 grid gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
                revealClass,
              )}
              style={revealStyle(2)}
            >
              <HoursByMonthChart stats={sessionStats} year={selectedYear} />
              <StreakCard stats={sessionStats} year={selectedYear} />
            </div>
            <div
              className={cn(
                'afterplay-stats-split mt-4 grid gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
                revealClass,
              )}
              style={revealStyle(3)}
            >
              <SpendByMonthChart spendEvents={spendEvents} year={selectedYear} />
              <WhenDoYouPlayChart stats={sessionStats} year={selectedYear} />
            </div>

            <StatsChapterHeading
              id="cast"
              title="The games that defined it"
              description="Leaders, finishes and the shape of the library behind the hours."
            />
            <div
              className={cn(
                'afterplay-stats-split grid grid-cols-2 gap-4',
                'min-[1180px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]',
                '[&>*:first-child]:col-span-2 min-[1180px]:[&>*:first-child]:col-span-1',
                revealClass,
              )}
              style={revealStyle(4)}
            >
              <MostPlayedList entries={playedEntries} onOpenGame={openGame} />
              <GenreRadar minutesByAxis={minutesByAxis} />
              {selectedYear === 'all' ? (
                <StatusBreakdown mode="all-time" games={games} />
              ) : (
                <StatusBreakdown mode="year" stateEvents={stateEvents} year={selectedYear} />
              )}
            </div>
            <div
              className={cn(
                'afterplay-stats-split mt-4 grid gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
                revealClass,
              )}
              style={revealStyle(5)}
            >
              <CompletedGallery
                stateEvents={stateEvents}
                games={games}
                year={selectedYear}
                onOpenGame={openGame}
              />
              <GameAgeDonut entries={ageEntries} year={selectedYear} />
            </div>

            <StatsChapterHeading
              id="pace"
              title="How you actually play"
              description="Your sessions against estimates, without turning either into a target."
            />
            <div
              className={cn(
                'afterplay-stats-split grid gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
                revealClass,
              )}
              style={revealStyle(6)}
            >
              <HltbCompareList
                games={games}
                stateEvents={stateEvents}
                stats={sessionStats}
                year={selectedYear}
                onOpenGame={openGame}
              />
              <SessionLengthHistogram stats={sessionStats} year={selectedYear} variant="overview" />
            </div>

            <StatsChapterHeading
              id="backlog"
              title="What entered, what left, what waits"
              description="Backlog as history and balance: information, never a guilt counter."
            />
            <div className={revealClass} style={revealStyle(7)}>
              <BacklogFlowChart
                games={games}
                plannedGames={plannedGames}
                stateEvents={stateEvents}
                year={selectedYear}
              />
            </div>
            <div className={cn('mt-4', revealClass)} style={revealStyle(8)}>
              {selectedYear === 'all' ? (
                <BacklogDebtCard
                  mode="all-time"
                  games={games}
                  plannedGames={plannedGames}
                  pace={sessionStats.pace}
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

            <StatsChapterHeading
              id="cabinet"
              title="The cabinet"
              description="Rare unlocks, perfect games and the moments that stood out."
            />
            <div className={revealClass} style={revealStyle(9)}>
              <AchievementsShowcase year={selectedYear} onOpenGame={openGame} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
