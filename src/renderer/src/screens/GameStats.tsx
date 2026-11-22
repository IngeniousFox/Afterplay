import { cn } from '../lib/utils';
import { ChevronDown, ChevronRight, Play, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { GameJourneyCard } from '../components/stats/GameJourneyCard';
import { SessionLengthHistogram } from '../components/stats/SessionLengthHistogram';
import { ChartHeading, StatCard } from '../components/stats/StatCard';
import { WhenDoYouPlayChart } from '../components/stats/WhenDoYouPlayChart';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { GameCover } from '../components/GameCover';
import { GameBadges } from '../components/stats/GameBadges';
import { TimeOfDayCard } from '../components/stats/TimeOfDayCard';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useGame, useGames } from '../hooks/games';
import { useSessionStats } from '../hooks/stats';
import { useOffscreenAnimation } from '../hooks/useOffscreenAnimation';
import { chartGroup, chartPaused, GlowText, ScanBeam, Ticker, useInView } from '../components/fx';
import { useImageSrc } from '../hooks/useImageSrc';
import { yearsDesc } from '../lib/dateMath';
import { formatDateOnly, formatElapsed, formatHours, formatMoney, pluralize } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { hasMeasuredDuration, sessionDurationStats } from '../../../shared/domain/sessionMeasure';
import {
  buildSessionStats,
  EMPTY_SESSION_STATS,
  topWeekdayIndexOf,
} from '../../../shared/domain/sessionStats';
import { sessionActivity } from '../../../shared/domain/sessionActivity';
import {
  floatingPanelClass,
  primaryButtonClass,
  revealClass,
  revealStyle,
  secondaryButtonClass,
} from '../lib/styles';
import { longestStreak, playedDayKeys } from '../../../shared/domain/streaks';
import type { GameId } from '../../../shared/entityIds';

type GameStatsProps = {
  gameId: GameId;
  onOpenGame: () => void;
  onClearFilter: () => void;
  onSelectGame: (gameId: GameId) => void;
};

// "a Sundays game" — nombres en plural para frasear costumbres, lunes
// primero como en el resto de la app.
const DAY_NAMES = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
];

// Una cifra del juego sin caja (stats-game.png): valor en Big Shoulders y
// rótulo debajo. La primera, las horas, es la cifra protagonista.
const GameMetric = ({
  label,
  value,
  detail,
  hero = false,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  hero?: boolean;
}): React.JSX.Element => (
  <div className={cn('afterplay-game-metric min-w-0', hero && 'pr-6')}>
    <strong
      className={cn(
        'afterplay-game-metric-value block font-display leading-[0.86] font-bold whitespace-nowrap tabular-nums',
        hero
          ? 'text-[clamp(84px,8vw,124px)] text-phosphor [text-shadow:0_0_36px_rgb(255_179_71/0.32)]'
          : 'text-[44px] text-bone',
      )}
    >
      {value}
    </strong>
    <span className="afterplay-game-metric-label mt-2 block text-small text-dust">{label}</span>
    {detail && (
      <span className="afterplay-game-metric-detail block text-micro text-dust">{detail}</span>
    )}
  </div>
);

// Un récord de sesión: rótulo, cifra en Big Shoulders y detalle, sin caja.
const RecordTile = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): React.JSX.Element => (
  <div className="afterplay-game-record min-w-0 border-b border-line pb-3">
    <span className="afterplay-game-record-label block text-small text-dust">{label}</span>
    <strong className="afterplay-game-record-value block font-display text-[34px] leading-tight font-bold text-bone tabular-nums">
      {value}
    </strong>
    {detail && (
      <span className="afterplay-game-record-detail block text-micro text-dust">{detail}</span>
    )}
  </div>
);

const GameChapter = ({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.JSX.Element => (
  <div
    className="afterplay-game-chapter mt-12 mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1"
    role="heading"
    aria-level={2}
  >
    <strong className="font-display text-[34px] leading-none font-bold text-bone">{title}</strong>
    <small className="text-body text-dust">{description}</small>
  </div>
);

// Las horas con las unidades pequeñas y apagadas: la cifra se lee primero.
const HoursFigure = ({ hours }: { hours: number }): React.JSX.Element => (
  <>
    {formatHours(hours)
      .split(/([hm])/)
      .map((part, index) =>
        part === 'h' || part === 'm' ? (
          <span key={index} className="mr-[0.1em] text-[0.4em] text-phosphor-lo">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
  </>
);

// El arte del banner con un Ken Burns lento, en pausa cuando el banner no se
// ve (useOffscreenAnimation). Reduced motion: quieto.
const BannerArt = ({ src }: { src: string }): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <img
      ref={observe}
      src={src}
      alt=""
      className="afterplay-game-stats-hero-art absolute inset-0 -z-2 size-full animate-ken-burns object-cover opacity-55 motion-reduce:animate-none"
      style={{ animationPlayState: playState }}
    />
  );
};

// Anillo del share de horas — el mismo dato que el porcentaje, convertido en
// la pieza central de la comparativa (sin falsear los shares pequeños). Se
// dibuja la primera vez que entra en vista.
const ShareRing = ({ pct }: { pct: number }): React.JSX.Element => {
  const { observe, inView } = useInView();
  const size = 104;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Un share minúsculo (0.1%) pinta al menos un arco visible — el número al
  // lado ya dice la verdad exacta.
  const arc = Math.max(0.02, Math.min(1, pct / 100)) * circumference;
  return (
    <div
      ref={observe}
      data-inview={inView || undefined}
      className={cn(
        'afterplay-game-share-ring relative grid size-26 flex-none place-items-center',
        chartGroup,
      )}
      role="img"
      aria-label={`${pct.toFixed(1)}% of all playtime`}
    >
      <svg
        className="absolute inset-0"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-raised)"
          strokeWidth={stroke}
        />
        <circle
          className={cn(
            'afterplay-game-share-arc drop-shadow-[0_0_5px_rgb(255_179_71/0.5)]',
            'animate-[afterplay-game-ring-in_900ms_var(--ease-out)_backwards]',
            chartPaused,
          )}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-phosphor)"
          strokeWidth={stroke}
          strokeDasharray={`${arc} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <strong className="relative font-display text-[26px] leading-none font-bold text-bone tabular-nums">
        {pct.toFixed(1)}%
      </strong>
    </div>
  );
};

// Elegir otro juego sin salir de la pantalla: la columna de juegos ya no
// existe, así que la cabecera trae su propio buscador.
const GamePicker = ({
  games,
  currentId,
  onSelect,
}: {
  games: { id: GameId; title: string; coverUrl: string | null; totalHours: number }[];
  currentId: GameId;
  onSelect: (gameId: GameId) => void;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = games
    .filter((game) => !needle || game.title.toLowerCase().includes(needle))
    .sort((a, b) => b.totalHours - a.totalHours || a.title.localeCompare(b.title))
    .slice(0, 40);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger className={cn(secondaryButtonClass, 'afterplay-game-stats-picker h-10 py-0')}>
        Choose game
        <ChevronDown size={15} />
      </PopoverTrigger>
      <PopoverContent align="end" className={cn('w-80 p-1.5', floatingPanelClass)}>
        <label className="flex items-center gap-2 rounded-sm border border-line-strong bg-inset px-2.5 focus-within:border-phosphor">
          <Search size={14} className="text-dust" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a game"
            aria-label="Find a game"
            className="h-9 min-w-0 flex-1 bg-transparent text-body text-bone outline-hidden placeholder:text-dust"
          />
        </label>
        <div className="mt-1.5 max-h-80 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-2.5 py-3 text-small text-dust">No games match.</p>
          ) : (
            matches.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  onSelect(game.id);
                }}
                aria-current={game.id === currentId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left',
                  'hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-phosphor',
                  game.id === currentId && 'bg-selected',
                )}
              >
                <GameCover
                  url={game.coverUrl}
                  className="h-9 w-6.5 flex-none overflow-hidden rounded-[2px]"
                  iconSize={11}
                />
                <span className="min-w-0 flex-1 truncate text-small font-semibold text-bone">
                  {game.title}
                </span>
                <span className="flex-none text-micro text-dust tabular-nums">
                  {formatHours(game.totalHours)}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Bloque 5F — stats de un único juego (stats-game*.png): cabecera fija con
// migas, banner con el título enorme y el puesto, cifras sin caja, el
// recorrido, la comparativa con la biblioteca, récords, vitrina, HLTB y el
// ritmo de juego.
export const GameStats = ({
  gameId,
  onOpenGame,
  onClearFilter,
  onSelectGame,
}: GameStatsProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
  const { data: allGames = [] } = useGames();
  // Para las comparativas "vs tu biblioteca" (duración de sesión, día
  // favorito, share de sesiones): el resumen que calcula el main, no la lista
  // entera de sesiones (F-41).
  const { data: libraryStats = EMPTY_SESSION_STATS } = useSessionStats();
  const heroSrc = useImageSrc(game?.heroUrl ?? null, 'heroes');

  // game.iterations (useGame) trae las sesiones del juego completas, sin un
  // segundo viaje. Modelo v2: toda sesión es tiempo jugado real, ya no hay
  // marcadores que filtrar.
  const realSessions = useMemo(() => game?.iterations.flatMap((it) => it.sessions) ?? [], [game]);
  // El mismo resumen que Stats pide al main para la biblioteca, armado aquí con
  // las sesiones de ESTE juego: las gráficas de abajo comparten componente y
  // regla con las globales.
  const gameStats = useMemo(
    () =>
      buildSessionStats(
        realSessions.map((session) => ({
          ...session,
          // Las de un juego siempre cuelgan de un playthrough (las de emulador sin
          // asignar no tienen y no están en game.iterations).
          iterationId: session.iterationId ?? '',
          gameId,
          gameTitle: game?.title ?? '',
        })),
        new Date(0),
      ),
    [realSessions, gameId, game?.title],
  );
  // Solo sesiones MEDIDAS: el heatmap descarta las manuales (tiempo tecleado
  // sin dia real que pintar), asi que un año que solo tenga manuales no puede
  // ofrecerse en el desplegable — salia elegido por defecto con la card vacia.
  const heatmapYears = useMemo(
    () =>
      yearsDesc(
        realSessions.filter((session) => !session.isManual).map((session) => session.startedAt),
      ),
    [realSessions],
  );
  // Propio de esta card, independiente del año que esté elegido (si acaso)
  // en la página global de Stats. Sin "All Time" aquí (ver YearPicker).
  // Mientras el usuario no toque el desplegable (null), se muestra el año
  // MÁS RECIENTE con sesiones de este juego — no el año actual a secas,
  // que podría salir vacío (y ni siquiera estar entre las opciones) si el
  // juego no se ha jugado este año.
  const [heatmapYear, setHeatmapYear] = useState<Year | null>(null);
  // GameStats no se remonta al cambiar de juego (la navegación entre fichas
  // solo cambia el prop gameId) — sin esto, un año elegido A MANO para un
  // juego sobrevivía al saltar a otro, y si ese año no tenía sesiones ahí
  // (lo normal), el heatmap salía vacío contradiciendo el propio criterio de
  // arriba ("el año más reciente CON sesiones de este juego").
  const [seenGameId, setSeenGameId] = useState(gameId);
  if (gameId !== seenGameId) {
    setSeenGameId(gameId);
    setHeatmapYear(null);
  }
  const effectiveHeatmapYear = heatmapYear ?? heatmapYears[0] ?? new Date().getFullYear();
  // Memoizados: los 4 useCountUp de abajo reprintan el componente en cada
  // frame de su animación (~700ms) mientras suben, y sin esto cada frame
  // repetía el filter+reduce de sessionDurationStats y el spread+sort de
  // longestStreak sobre TODAS las sesiones del juego para el mismo
  // resultado que el frame anterior (mismo motivo que Sessions.tsx).
  const { longestSec: longestSessionSec, avgSec: avgSessionSec } = useMemo(
    () => sessionDurationStats(realSessions),
    [realSessions],
  );
  // Lo que come la vitrina de trofeos: SOLO tiempo medido (lib/sessionStats,
  // la misma regla que el heatmap, las rachas y "When do you play it?"). Sin
  // esto, "Log 50 tracked sessions" contaba filas manuales del modelo viejo
  // y "Play a single session of 4 hours or more" se regalaba con una fila de
  // 60h con precisión de año — que ni es una sentada ni tuvo hora. Las cards
  // de arriba (SESSIONS, "Session records") siguen contándolas todas a
  // propósito: ahí la pregunta es qué consta, no cómo juegas.
  const measuredSessions = useMemo(() => realSessions.filter(hasMeasuredDuration), [realSessions]);
  const longestMeasuredSessionSec = useMemo(
    () => sessionDurationStats(measuredSessions).longestSec,
    [measuredSessions],
  );
  // La racha más larga DE ESTE JUEGO, de todos los tiempos (aquí no hay
  // filtro de año — el del heatmap de abajo es solo suyo). Días con al menos
  // una sesión trackeada real, ver lib/streaks.ts.
  const longestDailyStreak = useMemo(
    () => longestStreak(playedDayKeys(realSessions)),
    [realSessions],
  );

  // Récords: día más intenso, días distintos jugados, mes más cargado —
  // solo sesiones cerradas (las abiertas aún no tienen duración final).
  const records = useMemo(() => sessionActivity(realSessions), [realSessions]);

  const ranked = [...allGames].sort((a, b) => b.totalHours - a.totalHours);
  const rankIndex = ranked.findIndex((g) => g.id === gameId);
  const libraryTotalHours = allGames.reduce((sum, g) => sum + g.totalHours, 0);
  const sharePct = game && libraryTotalHours > 0 ? (game.totalHours / libraryTotalHours) * 100 : 0;
  const maxIterationHours = Math.max(1, ...(game?.iterations.map((it) => it.hours) ?? [1]));

  // Comparativas contra la biblioteca entera — frases, no números sueltos.
  const compareLines = useMemo(() => {
    const lines: { key: string; text: React.ReactNode }[] = [];

    const libAvgSec =
      libraryStats.library.closedCount > 0
        ? libraryStats.library.closedSeconds / libraryStats.library.closedCount
        : 0;
    if (avgSessionSec > 0 && libAvgSec > 0) {
      const diffMin = Math.round((avgSessionSec - libAvgSec) / 60);
      lines.push({
        key: 'length',
        text:
          Math.abs(diffMin) < 1 ? (
            <>Sessions here match your usual length</>
          ) : (
            <>
              Sessions here run{' '}
              <span className="font-semibold text-phosphor">
                {Math.abs(diffMin)}m {diffMin > 0 ? 'longer' : 'shorter'}
              </span>{' '}
              than your library average
            </>
          ),
      });
    }

    const gameDay = topWeekdayIndexOf(gameStats);
    const libDay = topWeekdayIndexOf(libraryStats);
    if (gameDay !== null && libDay !== null) {
      lines.push({
        key: 'weekday',
        text:
          gameDay === libDay ? (
            <>
              Mostly played on{' '}
              <span className="font-semibold text-phosphor">{DAY_NAMES[gameDay]}</span>, just like
              the rest of your library
            </>
          ) : (
            <>
              A <span className="font-semibold text-phosphor">{DAY_NAMES[gameDay]}</span> game —
              your library leans {DAY_NAMES[libDay]}
            </>
          ),
      });
    }

    if (realSessions.length > 0 && libraryStats.library.sessionCount > realSessions.length) {
      const ratio = Math.round(libraryStats.library.sessionCount / realSessions.length);
      lines.push({
        key: 'share',
        text:
          ratio >= 2 ? (
            <>
              <span className="font-semibold text-phosphor">1 in every {ratio}</span> of your
              sessions is this game
            </>
          ) : (
            <>Over half of all your sessions are this game</>
          ),
      });
    }

    return lines;
  }, [libraryStats, gameStats, realSessions, avgSessionSec]);

  if (isLoading || isError || !game) {
    return (
      <QueryStatePlaceholder
        isLoading={isLoading}
        errorText="Couldn't load stats for this game."
        backLabel="Back to all games"
        onBack={onClearFilter}
      />
    );
  }

  const status = getGameStatusMeta(game.currentState);
  // ¿Completado alguna vez? — para el logro Beaten mira el HISTORIAL, no el
  // estado actual: un Beaten rejugado (ahora Playing) conserva su trofeo.
  const everBeaten = game.stateHistory.some((event) => event.type === 'completed');

  const rankLabel = rankIndex >= 0 ? `#${rankIndex + 1}` : '—';
  const biggestDayDate = records.biggestDay
    ? formatDateOnly(new Date(records.biggestDay.dayMs), 'day')
    : undefined;
  const busiestMonthDate = records.busiestMonth
    ? new Date(
        Math.floor(records.busiestMonth.monthKey / 12),
        records.busiestMonth.monthKey % 12,
        1,
      ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : undefined;

  const genreLine = [
    game.genres?.slice(0, 2).join(', '),
    game.officialPlatforms?.slice(0, 2).join(', '),
  ].filter((part): part is string => Boolean(part));

  return (
    <div
      className={cn(
        'afterplay-game-stats-screen relative h-full overflow-y-auto bg-cabinet',
        'scroll-pt-21',
      )}
    >
      {/* Cabecera fija: migas para volver al resumen, un buscador para saltar
          a otro juego y las dos acciones (All games, Open game). */}
      <header
        className={cn(
          'afterplay-game-stats-topbar sticky top-0 z-20 flex h-17 items-center gap-6 border-b border-line',
          'bg-cabinet/92 px-8 backdrop-blur-md',
        )}
      >
        <span className="font-display text-[44px] leading-none font-bold text-bone">Stats</span>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-body">
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded-sm font-semibold text-tube hover:text-tube-hi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
          >
            Overview
          </button>
          <ChevronRight size={15} className="flex-none text-dust" />
          <span className="truncate font-semibold text-bone" aria-current="page">
            {game.title}
          </span>
        </nav>
        <div className="ml-auto flex flex-none items-center gap-2">
          <GamePicker games={allGames} currentId={game.id} onSelect={onSelectGame} />
          <button
            type="button"
            onClick={onClearFilter}
            className={cn(secondaryButtonClass, 'afterplay-game-stats-secondary-action h-10 py-0')}
          >
            All games
          </button>
          <button
            type="button"
            onClick={onOpenGame}
            className={cn(primaryButtonClass, 'afterplay-game-stats-primary-action h-10 py-0')}
          >
            <Play size={15} fill="currentColor" />
            Open game
          </button>
        </div>
      </header>

      {/* key={game.id}: cambiar de juego remonta el árbol — la entrada
          escalonada y los contadores vuelven a animar. */}
      <div
        key={game.id}
        className="afterplay-game-stats-shell relative mx-auto max-w-[1600px] px-8 pt-5 pb-16"
      >
        <section
          className={cn(
            'afterplay-game-stats-hero relative isolate flex min-h-61 items-end overflow-hidden rounded-md border border-line bg-panel',
            'px-8 pt-16 pb-6',
            revealClass,
          )}
          style={revealStyle(0)}
          data-testid="game-stats-hero"
        >
          {heroSrc && <BannerArt src={heroSrc} />}
          <span
            className="absolute inset-0 -z-1 bg-[linear-gradient(90deg,var(--color-cabinet)_8%,rgb(16_20_22/0.7)_48%,rgb(16_20_22/0.35)),linear-gradient(0deg,var(--color-cabinet),transparent_70%)]"
            aria-hidden="true"
          />
          <span className="absolute inset-0 -z-1 bg-(image:--scan) opacity-60" aria-hidden="true" />
          <ScanBeam every={9} className="-z-1" />

          <div className="afterplay-game-stats-identity min-w-0 flex-1">
            <GlowText
              as="h1"
              tone="bone"
              className="font-display text-[clamp(48px,5.4vw,84px)] leading-[0.95] font-bold text-bone"
            >
              {game.title}
            </GlowText>
            <div
              className={cn(
                'afterplay-game-stats-status mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-bone',
                '[&>span+span]:border-l [&>span+span]:border-line-strong [&>span+span]:pl-3',
              )}
            >
              <span className="inline-flex items-center gap-2 font-semibold">
                <span
                  className="size-2 rounded-full"
                  style={{ background: status.color, boxShadow: `0 0 6px ${status.color}` }}
                />
                {status.label}
              </span>
              {genreLine.map((part) => (
                <span key={part}>{part}</span>
              ))}
              <span>{pluralize(game.iterations.length, 'playthrough')}</span>
              <span>{pluralize(realSessions.length, 'session')}</span>
            </div>
          </div>

          <aside
            className="afterplay-game-stats-rank flex-none text-right max-[900px]:hidden"
            aria-label={`${rankLabel} by playtime`}
          >
            {/* El puesto se enciende como un tubo, con su parpadeo. */}
            <GlowText
              flicker
              className="block font-display text-[96px] leading-[0.85] font-bold text-phosphor tabular-nums"
              style={{ animationDelay: '260ms' }}
            >
              {rankLabel}
            </GlowText>
            <small className="mt-1 block text-body text-dust">
              of {allGames.length} games by playtime
            </small>
            <em className="block text-body text-dust not-italic">
              {sharePct.toFixed(1)}% of all your hours
            </em>
          </aside>
        </section>

        <div
          className={cn(
            'afterplay-game-metrics relative mt-5 flex flex-wrap items-end gap-x-14 gap-y-5',
            revealClass,
          )}
          style={revealStyle(1)}
        >
          <GameMetric
            hero
            label={`Total hours${game.iterations.length > 1 ? `, ${game.iterations.length} playthroughs` : ''}`}
            value={
              <Ticker
                value={game.totalHours}
                duration={1000}
                format={formatHours}
                render={(hours) => <HoursFigure hours={hours} />}
              />
            }
          />
          <GameMetric
            label={
              avgSessionSec > 0
                ? `Sessions, ${formatElapsed(avgSessionSec)} average`
                : 'Sessions, no measured time'
            }
            value={<Ticker value={realSessions.length} />}
          />
          <GameMetric
            label="Cost per hour"
            value={
              game.costPerHour !== null ? (
                <Ticker value={game.costPerHour} format={formatMoney} />
              ) : (
                '—'
              )
            }
          />
          <GameMetric
            label={game.totalSpend > 0 ? 'Spent' : 'Spent, nothing logged'}
            value={<Ticker value={game.totalSpend} format={formatMoney} />}
          />
        </div>

        <div className={cn('mt-6', revealClass)} style={revealStyle(2)}>
          <GameJourneyCard
            addedAt={game.addedAt}
            planHistory={game.planHistory}
            stateHistory={game.stateHistory}
            sessions={realSessions}
          />
        </div>

        {game.iterations.length > 1 && (
          <StatCard className={cn('afterplay-game-playthroughs relative mt-4', revealClass)}>
            <ChartHeading
              className="mb-4"
              title="Every run"
              subtitle="How each playthrough stacks up"
              right={pluralize(game.iterations.length, 'playthrough')}
            />
            <div className="afterplay-game-playthrough-list flex flex-col">
              {game.iterations.map((iteration) => {
                const iterationStatus = getGameStatusMeta(iteration.currentState);
                const dates = `${
                  iteration.startedAt ? formatDateOnly(iteration.startedAt, 'day') : '—'
                } to ${iteration.endedAt ? formatDateOnly(iteration.endedAt, 'day') : 'ongoing'}`;
                return (
                  <div
                    key={iteration.id}
                    className="afterplay-game-playthrough grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] items-center gap-5 border-b border-line py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <span className="flex items-center gap-2 text-body font-semibold text-bone">
                        <span
                          className="size-2 flex-none rounded-full"
                          style={{ background: iterationStatus.color }}
                        />
                        <span className="truncate">{iteration.label}</span>
                      </span>
                      <small className="block text-micro text-dust">{dates}</small>
                    </div>
                    <span className="relative h-2.5 overflow-hidden rounded-[2px] bg-inset">
                      <span
                        className="afterplay-game-playthrough-fill absolute inset-y-0 left-0 origin-left rounded-[2px] bg-phosphor/85 animate-[afterplay-game-run-in_700ms_var(--ease-out)_backwards] motion-reduce:animate-none"
                        style={{
                          width: `${Math.max(2, (iteration.hours / maxIterationHours) * 100)}%`,
                        }}
                      />
                    </span>
                    <strong className="text-right text-small font-semibold whitespace-nowrap text-bone tabular-nums">
                      {formatHours(iteration.hours)}{' '}
                      <span className="font-normal text-dust">
                        · {formatMoney(iteration.spend)}
                      </span>
                    </strong>
                  </div>
                );
              })}
            </div>
          </StatCard>
        )}

        <div className={revealClass} style={revealStyle(3)}>
          <GameChapter
            title="Your signature"
            description="What makes this game different in your library."
          />
          <div className="afterplay-game-insight-grid grid gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <StatCard className="afterplay-game-library-card flex h-full flex-col">
              <ChartHeading title="Versus your library" right="The weight this game carries" />

              <div className="afterplay-game-library-stage mt-4 flex items-center gap-6 pb-4">
                <ShareRing pct={sharePct} />
                <div className="afterplay-game-library-rank flex min-w-0 flex-col">
                  <strong className="font-display text-[64px] leading-none font-bold text-bone tabular-nums">
                    {rankLabel}
                  </strong>
                  <small className="mt-1 text-small text-dust">
                    out of {allGames.length} games, by hours
                  </small>
                </div>
              </div>

              {compareLines.length > 0 && (
                <div className="afterplay-game-comparisons mt-auto flex flex-col">
                  {compareLines.map((line) => (
                    <div className="border-t border-line py-2.5 text-body text-bone" key={line.key}>
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </StatCard>

            <StatCard className="afterplay-game-records-card h-full">
              <ChartHeading title="Session records" right="The peaks hidden in your playtime" />
              <div className="afterplay-game-record-grid mt-4 grid grid-cols-2 gap-x-10 gap-y-3">
                <RecordTile
                  label="Average length"
                  value={formatElapsed(avgSessionSec)}
                  detail={`across ${pluralize(realSessions.length, 'session')}`}
                />
                <RecordTile label="Longest session" value={formatElapsed(longestSessionSec)} />
                <RecordTile
                  label="Biggest day"
                  value={records.biggestDay ? formatHours(records.biggestDay.seconds / 3600) : '—'}
                  detail={biggestDayDate}
                />
                <RecordTile label="Longest streak" value={pluralize(longestDailyStreak, 'day')} />
                <RecordTile label="Days played" value={pluralize(records.daysPlayed, 'day')} />
                <RecordTile
                  label="Busiest month"
                  value={
                    records.busiestMonth ? formatHours(records.busiestMonth.seconds / 3600) : '—'
                  }
                  detail={busiestMonthDate}
                />
              </div>
            </StatCard>
          </div>
        </div>

        <div
          className={cn(
            'afterplay-game-signature-grid mt-4 grid gap-4 [&>*]:h-full [&>*]:min-w-0',
            'min-[1180px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]',
            revealClass,
          )}
          style={revealStyle(4)}
        >
          <GameBadges
            totalHours={game.totalHours}
            totalSpent={game.totalSpend}
            longestSessionSec={longestMeasuredSessionSec}
            longestStreakDays={longestDailyStreak}
            sessionCount={measuredSessions.length}
            beaten={everBeaten}
            hltbCompletionist={game.hltbCompletionist}
            sessions={realSessions}
          />
          <TimeOfDayCard sessions={realSessions} />
        </div>

        <div
          className={cn('afterplay-game-hltb relative mt-4', revealClass)}
          style={revealStyle(5)}
        >
          <HowLongToBeatCard
            game={game}
            markerHours={game.totalHours}
            markerScope="total"
            variant="dossier"
          />
        </div>

        <div className={revealClass} style={revealStyle(6)}>
          <GameChapter
            title="Play rhythm"
            description="When, how often and for how long you return."
          />
          <div className="afterplay-game-chart-grid grid gap-4 min-[1000px]:grid-cols-2">
            <WhenDoYouPlayChart stats={gameStats} year="all" title="When do you play it?" />
            <SessionLengthHistogram stats={gameStats} year="all" />
          </div>
        </div>

        <div className={cn('mt-4', revealClass)} style={revealStyle(7)}>
          <ActivityHeatmap
            sessions={realSessions}
            title="Activity, this game"
            year={effectiveHeatmapYear}
            yearPicker={
              <YearPicker
                years={heatmapYears}
                value={effectiveHeatmapYear}
                onChange={setHeatmapYear}
                includeAllTime={false}
              />
            }
          />
        </div>
      </div>
    </div>
  );
};
