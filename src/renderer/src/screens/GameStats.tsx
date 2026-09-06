import { cn } from '../lib/utils';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  DollarSign,
  Flame,
  Gauge,
  Layers3,
  Medal,
  Sparkles,
  Trophy,
  Calendar as SessionsIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { GameJourneyCard } from '../components/stats/GameJourneyCard';
import { SessionLengthHistogram } from '../components/stats/SessionLengthHistogram';
import { StatCard } from '../components/stats/StatCard';
import { WhenDoYouPlayChart } from '../components/stats/WhenDoYouPlayChart';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { GameCover } from '../components/GameCover';
import { StatusIcon } from '../components/StatusIcon';
import { GameBadges } from '../components/stats/GameBadges';
import { TimeOfDayCard } from '../components/stats/TimeOfDayCard';
import { useGame, useGames } from '../hooks/games';
import { useSessions } from '../hooks/sessions';
import { useCountUp } from '../hooks/useCountUp';
import { useImageSrc } from '../hooks/useImageSrc';
import { AMBER, BLUE, GREEN, VIOLET } from '../lib/colors';
import { yearsDesc } from '../lib/dateMath';
import { formatDateOnly, formatElapsed, formatHours, formatMoney, pluralize } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { hasMeasuredDuration, sessionDurationStats } from '../lib/sessionStats';
import { sessionActivity } from '../lib/sessionActivity';
import { outlineButtonClass, revealClass, revealStyle } from '../lib/styles';
import { longestStreak, playedDayKeys } from '../lib/streaks';

const GameDataCard = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-game-data-card',
      'min-w-0 h-full',
      '[&>.afterplay-stat-card]:border-white/[0.075]',
      '[&>.afterplay-stat-card]:shadow-[inset_0_1px_rgba(255,255,255,0.025)]',
      '[&>.afterplay-stat-card]:min-w-0 [&>.afterplay-stat-card]:h-full',
      '[&>.afterplay-stat-card]:[background:radial-gradient(circle_at_100%_0%,rgba(133,163,214,0.035),transparent_34%),var(--card)]',
      '[&>.afterplay-stat-card]:[transition:border-color_220ms_ease,box-shadow_260ms_ease]',
      '[&>.afterplay-stat-card:hover]:border-white/[0.105]',
      '[&>.afterplay-stat-card:hover]:shadow-[inset_0_1px_rgba(255,255,255,0.035),0_18px_42px_rgba(0,0,0,0.13)]',
      'motion-reduce:[&>.afterplay-stat-card]:animate-none',
      'motion-reduce:[&>.afterplay-stat-card]:transition-none',
    )}
  >
    {children}
  </div>
);

type GameStatsProps = {
  gameId: number;
  onOpenGame: () => void;
  onClearFilter: () => void;
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

type WeekdaySession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

// Día de la semana con más horas de un conjunto de sesiones (índice de
// DAY_NAMES), o null sin sesiones cerradas — mismas reglas de datos que
// WhenDoYouPlayChart.
const topWeekdayIndex = (sessions: WeekdaySession[]): number | null => {
  const seconds = Array.from({ length: 7 }, () => 0);
  for (const session of sessions) {
    if (!hasMeasuredDuration(session)) continue;
    seconds[(session.startedAt.getDay() + 6) % 7] += session.durationSec ?? 0;
  }
  const max = Math.max(...seconds);
  return max > 0 ? seconds.indexOf(max) : null;
};

type GameMetricProps = {
  Icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent: string;
};

const GameMetric = ({ Icon, label, value, detail, accent }: GameMetricProps): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-game-metric group/metric',
      'relative grid min-h-28 min-w-0 grid-cols-[30px_minmax(0,_1fr)] items-start gap-2.75 overflow-hidden',
      'rounded-[13px] px-3.25 py-3.75',
      '[--game-accent:var(--primary)] border border-white/[0.085]',
      '[background:radial-gradient(circle_at_0%_0%,color-mix(in_srgb,var(--game-accent)_12%,transparent),transparent_52%),rgba(17,20,18,0.96)]',
      'shadow-[0_14px_30px_rgba(0,0,0,0.28),inset_0_1px_rgba(255,255,255,0.035)]',
      'after:absolute after:right-[14px] after:bottom-[0] after:left-[14px] after:h-[1px]',
      'after:[background:linear-gradient(90deg,transparent,var(--game-accent),transparent)]',
      "after:content-[''] after:opacity-[0.32] after:transform-[scaleX(0.32)]",
      'after:[transition:opacity_240ms_ease,transform_360ms_cubic-bezier(0.22,1,0.36,1)]',
      'hover:z-[2] hover:border-[color-mix(in_srgb,var(--game-accent)_30%,rgba(255,255,255,0.08))]',
      'hover:shadow-[0_18px_38px_rgba(0,0,0,0.35),0_0_28px_color-mix(in_srgb,var(--game-accent)_8%,transparent)]',
      'hover:transform-[translateY(-4px)] [&:hover::after]:opacity-[0.75]',
      '[&:hover::after]:transform-[scaleX(1)]',
      '[transition:transform_300ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,box-shadow_260ms_ease]',
      'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:after:animate-none',
      'motion-reduce:after:transition-none',
    )}
    style={{ '--game-accent': accent } as CSSProperties}
  >
    <span
      className={cn(
        'afterplay-game-metric-icon',
        'flex size-7.5 items-center justify-center rounded-[8px] text-(--game-accent)',
        'border border-[color-mix(in_srgb,var(--game-accent)_30%,transparent)]',
        'bg-[color-mix(in_srgb,var(--game-accent)_12%,transparent)]',
        'shadow-[0_0_18px_color-mix(in_srgb,var(--game-accent)_8%,transparent)]',
        'group-hover/metric:transform-[rotate(-5deg)_scale(1.08)]',
        '[transition:transform_320ms_cubic-bezier(0.22,1,0.36,1)]',
        'motion-reduce:animate-none motion-reduce:transition-none',
      )}
    >
      <Icon size={15} />
    </span>
    <span className="afterplay-game-metric-copy flex min-w-0 flex-col">
      <span className="afterplay-game-metric-label truncate text-[8.5px] font-black tracking-[0.11em] text-white/[0.39]">
        {label}
      </span>
      <strong className="afterplay-game-metric-value mt-1 truncate text-[24px] leading-[1.05] font-black tracking-[-0.035em] text-foreground">
        {value}
      </strong>
      <span className="afterplay-game-metric-detail text-[color-mix(in_srgb,var(--game-accent)_72%,rgba(255,255,255,0.45))] mt-1.25 truncate text-[9.5px] font-[650]">
        {detail}
      </span>
    </span>
  </div>
);

type RecordTileProps = {
  Icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  accent: string;
};

const RecordTile = ({ Icon, label, value, detail, accent }: RecordTileProps): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-game-record',
      'relative grid min-h-19.5 min-w-0 grid-cols-[26px_minmax(0,_1fr)] items-start gap-2.25 overflow-hidden',
      'rounded-[10px] p-2.5',
      '[--record-accent:var(--primary)] border border-white/[0.055] bg-white/[0.022]',
      'after:absolute after:right-[-18px] after:bottom-[-22px] after:w-[50px] after:h-[50px]',
      "after:rounded-[50%] after:bg-(--record-accent) after:content-[''] after:opacity-[0.06]",
      'after:filter-[blur(14px)]',
      'hover:border-[color-mix(in_srgb,var(--record-accent)_24%,rgba(255,255,255,0.05))]',
      'hover:bg-white/[0.032] hover:transform-[translateY(-2px)]',
      '[transition:border-color_180ms_ease,background-color_180ms_ease,transform_250ms_cubic-bezier(0.22,1,0.36,1)]',
      'motion-reduce:animate-none motion-reduce:transition-none',
    )}
    style={{ '--record-accent': accent } as CSSProperties}
  >
    <span
      className={cn(
        'afterplay-game-record-icon',
        'flex size-6.5 items-center justify-center rounded-[7px] text-(--record-accent)',
        'border border-[color-mix(in_srgb,var(--record-accent)_24%,transparent)]',
        'bg-[color-mix(in_srgb,var(--record-accent)_9%,transparent)]',
      )}
    >
      <Icon size={14} />
    </span>
    <span className="afterplay-game-record-copy flex min-w-0 flex-col">
      <span className="afterplay-game-record-label truncate text-[8.5px] font-[750] text-white/[0.32]">
        {label}
      </span>
      <strong className="afterplay-game-record-value mt-0.75 truncate text-[14px] leading-[1.05] font-[850] text-foreground">
        {value}
      </strong>
      {detail && (
        <span className="afterplay-game-record-detail text-[color-mix(in_srgb,var(--record-accent)_68%,rgba(255,255,255,0.4))] mt-0.75 truncate text-[8.5px] font-[650]">
          {detail}
        </span>
      )}
    </span>
  </div>
);

const GameChapter = ({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}): React.JSX.Element => (
  <div
    className="afterplay-game-chapter [&>i]:[background:linear-gradient(90deg,rgba(255,255,255,0.09),transparent)] [@media(width<=760px)]:[&_small]:hidden mx-0.75 mt-7.25 mb-2.75 flex items-center gap-2.75"
    role="heading"
    aria-level={2}
  >
    <span className="text-[10px] font-black tracking-[0.12em] text-primary">{number}</span>
    <div className="flex min-w-max items-baseline gap-2.25">
      <strong className="text-[10px] font-black tracking-[0.13em] text-white/[0.75]">
        {title}
      </strong>
      <small className="text-[10px] text-white/[0.29]">{description}</small>
    </div>
    <i className="h-0.25 w-full" />
  </div>
);

// Anillo de progreso del share — el mismo dato que el % gigante, convertido
// en una pieza central de la comparativa (sin falsear los shares pequeños).
const ShareRing = ({ pct }: { pct: number }): React.JSX.Element => {
  const size = 124;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Un share minúsculo (0.1%) pinta al menos un arco visible — el número al
  // lado ya dice la verdad exacta.
  const arc = Math.max(0.02, Math.min(1, pct / 100)) * circumference;
  return (
    <div
      className={cn(
        'afterplay-game-share-ring',
        'relative grid size-31 flex-none place-items-center',
        "before:absolute before:border before:border-white/[0.035] before:rounded-[50%] before:content-['']",
        'before:inset-[8px]',
        "after:absolute after:border after:border-white/[0.035] after:rounded-[50%] after:content-['']",
        'after:inset-[19px]',
        '[&_svg]:filter-[drop-shadow(0_0_10px_rgba(47,220,126,0.22))]',
      )}
      role="img"
      aria-label={`${pct.toFixed(1)}% of all playtime`}
    >
      <svg
        className="absolute inset-0 overflow-visible"
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
          stroke="rgba(255,255,255,.055)"
          strokeWidth={stroke}
        />
        <circle
          className="afterplay-game-share-arc animate-[afterplay-game-ring-in_900ms_cubic-bezier(0.22,1,0.36,1)_backwards] motion-reduce:animate-none motion-reduce:transition-none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={GREEN}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="z-1 flex flex-col items-center">
        <strong className="text-[23px] leading-none font-black tracking-[-0.04em] text-foreground">
          {pct.toFixed(1)}%
        </strong>
        <small className="mt-1 text-[7px] font-black tracking-[0.14em] text-primary">
          PLAYTIME
        </small>
      </span>
    </div>
  );
};

// Bloque 5F — stats de un único juego, con el hero del juego de fondo en la
// cabecera y el mismo lenguaje "juicy" que la página global: journey,
// récords, comparativas contra tu biblioteca, mini-gráficos propios y los
// playthroughs como filas-barra.
export const GameStats = ({
  gameId,
  onOpenGame,
  onClearFilter,
}: GameStatsProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
  const { data: allGames = [] } = useGames();
  // Para las comparativas "vs tu biblioteca" (duración de sesión, día
  // favorito, share de sesiones).
  const { data: librarySessions = [] } = useSessions();
  const heroSrc = useImageSrc(game?.heroUrl ?? null, 'heroes');

  // useSessions() ya trae todo esto, pero game.iterations (useGame) es la
  // misma info sin un segundo viaje — el detalle de un juego ya la trae
  // completa, no hace falta pedirla dos veces. Modelo v2: toda sesión es
  // tiempo jugado real, ya no hay marcadores que filtrar.
  const realSessions = useMemo(() => game?.iterations.flatMap((it) => it.sessions) ?? [], [game]);
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

  // Contadores animados de las 4 métricas — suben de 0 a su valor al entrar
  // (y al cambiar de juego). Cero fuerza el valor sin animar (useCountUp).
  const animatedHours = useCountUp(game?.totalHours ?? 0);
  const animatedSpent = useCountUp(game?.totalSpend ?? 0);
  const animatedSessions = useCountUp(realSessions.length);
  const animatedCost = useCountUp(game?.costPerHour ?? 0);

  // Comparativas contra la biblioteca entera — frases, no números sueltos.
  const compareLines = useMemo(() => {
    const lines: { key: string; text: React.ReactNode }[] = [];

    const libAvgSec = sessionDurationStats(librarySessions).avgSec;
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
              <span className="font-bold text-primary">
                {Math.abs(diffMin)}m {diffMin > 0 ? 'longer' : 'shorter'}
              </span>{' '}
              than your library average
            </>
          ),
      });
    }

    const gameDay = topWeekdayIndex(realSessions);
    const libDay = topWeekdayIndex(librarySessions);
    if (gameDay !== null && libDay !== null) {
      lines.push({
        key: 'weekday',
        text:
          gameDay === libDay ? (
            <>
              Mostly played on <span className="font-bold text-primary">{DAY_NAMES[gameDay]}</span>,
              just like the rest of your library
            </>
          ) : (
            <>
              A <span className="font-bold text-primary">{DAY_NAMES[gameDay]}</span> game — your
              library leans {DAY_NAMES[libDay]}
            </>
          ),
      });
    }

    if (realSessions.length > 0 && librarySessions.length > realSessions.length) {
      const ratio = Math.round(librarySessions.length / realSessions.length);
      lines.push({
        key: 'share',
        text:
          ratio >= 2 ? (
            <>
              <span className="font-bold text-primary">1 in every {ratio}</span> of your sessions is
              this game
            </>
          ) : (
            <>Over half of all your sessions are this game</>
          ),
      });
    }

    return lines;
  }, [librarySessions, realSessions, avgSessionSec]);

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

  return (
    <div
      className={cn(
        'afterplay-game-stats-screen',
        'relative h-full overflow-y-auto px-6 pt-6 pb-16',
        '[background:radial-gradient(circle_at_48%_-12%,rgba(47,220,126,0.055),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.008),transparent_24%)]',
      )}
    >
      {/* key={game.id}: cambiar de juego remonta el árbol — la entrada
          escalonada y los contadores vuelven a animar. */}
      <div key={game.id} className="afterplay-game-stats-shell relative mx-auto max-w-295">
        <section
          className={cn(
            'afterplay-game-stats-hero group/stats-hero',
            'relative min-h-[238px] overflow-hidden rounded-[19px] isolate',
            '[--status-color:var(--primary)] border border-white/[0.09]',
            '[background:radial-gradient(circle_at_20%_0%,color-mix(in_srgb,var(--status-color)_18%,transparent),transparent_44%),#101311]',
            'shadow-[0_28px_70px_rgba(0,0,0,0.28),inset_0_1px_rgba(255,255,255,0.035)]',
            'before:absolute before:z-[-1] before:inset-[0]',
            'before:[background:linear-gradient(90deg,rgba(10,12,11,0.97)_0%,rgba(10,12,11,0.84)_42%,rgba(10,12,11,0.58)_72%,rgba(10,12,11,0.9)_100%),linear-gradient(0deg,rgba(10,12,11,0.74),transparent_62%)]',
            "before:content-['']",
            'after:absolute after:top-[0] after:right-[7%] after:left-[7%] after:h-[1px]',
            'after:[background:linear-gradient(90deg,transparent,var(--status-color),transparent)]',
            "after:shadow-[0_0_22px_color-mix(in_srgb,var(--status-color)_50%,transparent)] after:content-['']",
            'after:opacity-[0.75]',
            revealClass,
          )}
          style={{ ...revealStyle(0), '--status-color': status.color } as CSSProperties}
          data-testid="game-stats-hero"
        >
          {heroSrc && (
            <img
              src={heroSrc}
              alt=""
              className={cn(
                'afterplay-game-stats-hero-art',
                'absolute inset-[-7%] -z-2 size-[114%] object-cover',
                'filter-[saturate(0.88)_contrast(1.05)] opacity-[0.62]',
                'animate-[afterplay-game-art-drift_18s_ease-in-out_infinite_alternate]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
            />
          )}
          <span
            className={cn(
              'afterplay-game-stats-hero-grid',
              'absolute inset-0 -z-1',
              'bg-[linear-gradient(rgba(255,255,255,0.017)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.017)_1px,transparent_1px)]',
              'bg-size-[31px_31px] [mask-image:linear-gradient(90deg,black,transparent_72%)]',
            )}
            aria-hidden="true"
          />
          <span
            className="afterplay-game-stats-hero-glow bg-(--status-color) filter-[blur(72px)] absolute -top-25 left-[18%] -z-1 h-70 w-105 rounded-[50%] opacity-[0.09]"
            aria-hidden="true"
          />

          <div
            className={cn(
              'afterplay-game-stats-hero-body',
              'grid min-h-59.5 grid-cols-[104px_minmax(0,_1fr)_150px] items-center gap-6.25 px-7.25 py-6.75',
              '[@media(1040px<width<=1120px)]:grid-cols-[96px_minmax(0,1fr)_132px]',
              '[@media(1040px<width<=1120px)]:gap-[20px] [@media(1040px<width<=1120px)]:px-[23px]',
              '[@media(760px<width<=1040px)]:grid-cols-[96px_minmax(0,1fr)] [@media(760px<width<=1040px)]:gap-[20px]',
              '[@media(760px<width<=1040px)]:px-[23px] [@media(width<=760px)]:grid-cols-[74px_minmax(0,1fr)]',
              '[@media(width<=760px)]:gap-[15px] [@media(width<=760px)]:pt-[22px] [@media(width<=760px)]:pr-[18px]',
              '[@media(width<=760px)]:pb-[22px] [@media(width<=760px)]:pl-[18px]',
            )}
          >
            <div className="afterplay-game-stats-cover-wrap perspective-[700px] relative w-max">
              <GameCover
                url={game.coverUrl}
                className={cn(
                  'afterplay-game-stats-cover',
                  'aspect-[2/3] h-39 overflow-hidden rounded-[11px]',
                  'shadow-[0_22px_34px_rgba(0,0,0,0.52),0_0_0_1px_rgba(255,255,255,0.035)] border border-white/15',
                  'group-hover/stats-hero:transform-[translateY(-3px)_rotateY(2deg)_rotateZ(-0.6deg)]',
                  'group-hover/stats-hero:shadow-[0_29px_42px_rgba(0,0,0,0.58),0_0_28px_color-mix(in_srgb,var(--status-color)_14%,transparent)]',
                  'group-hover/stats-hero:filter-[saturate(1.08)_brightness(1.035)]',
                  '[transition:transform_420ms_cubic-bezier(0.22,1,0.36,1),box-shadow_320ms_ease,filter_320ms_ease]',
                  '[@media(1040px<width<=1120px)]:h-[144px] [@media(760px<width<=1040px)]:h-[144px]',
                  '[@media(width<=760px)]:h-[112px]',
                  'motion-reduce:animate-none motion-reduce:transition-none',
                )}
                iconSize={25}
              />
              <span
                className="afterplay-game-stats-cover-line bg-(--status-color) shadow-[0_0_14px_var(--status-color)] absolute right-2.5 -bottom-1.75 left-2.5 h-0.5 rounded-[99px] opacity-[0.68]"
                aria-hidden="true"
              />
            </div>

            <div className="afterplay-game-stats-identity [&_h1]:text-shadow-[0_7px_26px_rgba(0,0,0,0.44)] min-w-0">
              <div className="afterplay-game-stats-kicker [&_i]:[background:linear-gradient(90deg,var(--status-color),transparent)] flex items-center gap-1.75 text-[9px] font-black tracking-[0.16em] text-(--status-color)">
                <Sparkles size={12} />
                <span>PERSONAL DOSSIER</span>
                <i className="h-0.25 w-9.5 opacity-[0.7]" />
              </div>
              <h1 className="mt-1.75 truncate text-[clamp(28px,_3.2vw,_38px)] leading-[1.04] font-black tracking-[-0.035em] text-foreground">
                {game.title}
              </h1>
              <div
                className={cn(
                  'afterplay-game-stats-status',
                  'mt-2.25 flex items-center gap-2.25 text-[12px] text-white/[0.46]',
                  '[&>span+span::before]:mr-[9px] [&>span+span::before]:text-white/[0.18]',
                  "[&>span+span::before]:[content:'/']",
                  '[@media(width<=760px)]:[&>span+span]:hidden',
                )}
              >
                <span
                  className="inline-flex items-center gap-1.25 font-[750]"
                  style={{ color: status.color }}
                >
                  <StatusIcon meta={status} size={14} />
                  {status.label}
                </span>
                <span>your history with this game, decoded</span>
              </div>

              <div
                className={cn(
                  'afterplay-game-stats-facts',
                  'mt-4.25 flex flex-wrap gap-1.75',
                  '[&_span]:border [&_span]:border-white/[0.075] [&_span]:bg-[rgba(5,7,6,0.4)]',
                  '[&_span]:[backdrop-filter:blur(10px)]',
                  '[@media(width<=760px)]:[&_span:nth-child(3)]:hidden',
                )}
              >
                <span className="inline-flex items-center gap-1.25 rounded-[7px] px-2 py-1.25 text-[10.5px] font-[650] text-white/[0.64]">
                  <Medal size={12} /> {rankLabel} in playtime
                </span>
                <span className="inline-flex items-center gap-1.25 rounded-[7px] px-2 py-1.25 text-[10.5px] font-[650] text-white/[0.64]">
                  <Layers3 size={12} /> {pluralize(game.iterations.length, 'playthrough')}
                </span>
                <span className="inline-flex items-center gap-1.25 rounded-[7px] px-2 py-1.25 text-[10.5px] font-[650] text-white/[0.64]">
                  <SessionsIcon size={12} /> {pluralize(realSessions.length, 'session')}
                </span>
              </div>

              <div className="afterplay-game-stats-actions mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={onOpenGame}
                  className={cn(
                    outlineButtonClass,
                    'afterplay-game-stats-primary-action',
                    'text-(--status-color)',
                    'border-[color-mix(in_srgb,var(--status-color)_48%,transparent)]',
                    'bg-[color-mix(in_srgb,var(--status-color)_13%,rgba(0,0,0,0.25))]',
                    '[&:is(:hover,:focus-visible)]:transform-[translateY(-2px)]',
                    '[&:is(:hover,:focus-visible)]:bg-[color-mix(in_srgb,var(--status-color)_18%,rgba(0,0,0,0.2))]',
                    '[&:is(:hover,:focus-visible)]:shadow-[0_9px_26px_color-mix(in_srgb,var(--status-color)_14%,transparent)]',
                    '[transition:transform_240ms_cubic-bezier(0.22,1,0.36,1),border-color_180ms_ease,background-color_180ms_ease,box-shadow_220ms_ease]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                >
                  <span>Open game</span>
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={onClearFilter}
                  className={cn(
                    outlineButtonClass,
                    'afterplay-game-stats-secondary-action',
                    'text-white/[0.72]',
                    'border-white/[0.1] bg-white/[0.035]',
                    '[&:is(:hover,:focus-visible)]:transform-[translateY(-2px)]',
                    '[&:is(:hover,:focus-visible)]:border-white/[0.17] [&:is(:hover,:focus-visible)]:bg-white/[0.06]',
                    '[transition:transform_240ms_cubic-bezier(0.22,1,0.36,1),border-color_180ms_ease,background-color_180ms_ease,box-shadow_220ms_ease]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                >
                  All games
                </button>
              </div>
            </div>

            <aside
              className={cn(
                'afterplay-game-stats-rank',
                'relative flex min-h-36.25 flex-col items-center justify-center overflow-hidden rounded-[14px]',
                'text-center',
                'border border-white/[0.085]',
                '[background:linear-gradient(145deg,rgba(255,255,255,0.065),rgba(0,0,0,0.22))]',
                'shadow-[inset_0_1px_rgba(255,255,255,0.04)] [backdrop-filter:blur(14px)]',
                'before:absolute before:top-[-30px] before:w-[100px] before:h-[70px] before:rounded-[50%]',
                "before:bg-(--status-color) before:content-[''] before:opacity-[0.12] before:filter-[blur(30px)]",
                '[&_strong]:text-shadow-[0_0_26px_color-mix(in_srgb,var(--status-color)_22%,transparent)]',
                '[&_i]:[background:linear-gradient(90deg,transparent,var(--status-color),transparent)]',
                '[@media(760px<width<=1040px)]:hidden [@media(width<=760px)]:hidden',
              )}
              aria-label={`${rankLabel} by playtime`}
            >
              <span className="text-[8.5px] font-black tracking-[0.14em] text-white/[0.36]">
                LIBRARY RANK
              </span>
              <strong className="mt-0.75 text-[45px] leading-none font-[950] tracking-[-0.06em] text-foreground">
                {rankLabel}
              </strong>
              <small className="mt-0.25 text-[10px] text-white/[0.42]">of {allGames.length}</small>
              <i className="mx-0 mt-2.5 mb-2 h-0.25 w-12.5" />
              <em className="text-[9.5px] font-bold text-(--status-color) not-italic">
                {sharePct.toFixed(1)}% of all your hours
              </em>
            </aside>
          </div>
        </section>

        <div
          className={`afterplay-game-metrics relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 ${revealClass}`}
          style={revealStyle(1)}
        >
          <GameMetric
            Icon={Clock}
            label="TOTAL HOURS"
            value={formatHours(animatedHours)}
            detail={`${sharePct.toFixed(1)}% of your library`}
            accent={GREEN}
          />
          <GameMetric
            Icon={Gauge}
            label="COST / HOUR"
            value={game.costPerHour !== null ? formatMoney(animatedCost) : '—'}
            detail={
              game.totalSpend > 0
                ? `${formatMoney(game.totalSpend)} total spend`
                : 'No spend logged'
            }
            accent={VIOLET}
          />
          <GameMetric
            Icon={SessionsIcon}
            label="SESSIONS"
            value={String(Math.round(animatedSessions))}
            detail={
              avgSessionSec > 0 ? `${formatElapsed(avgSessionSec)} average` : 'No measured time'
            }
            accent={BLUE}
          />
          <GameMetric
            Icon={DollarSign}
            label="TOTAL SPENT"
            value={formatMoney(animatedSpent)}
            detail={`across ${pluralize(game.iterations.length, 'playthrough')}`}
            accent={AMBER}
          />
        </div>

        <div className={revealClass} style={revealStyle(2)}>
          <GameChapter
            number="01"
            title="THE RUN"
            description="From first intent to the last session"
          />
          <GameJourneyCard
            addedAt={game.addedAt}
            stateHistory={game.stateHistory}
            sessions={realSessions}
          />
        </div>

        {game.iterations.length > 1 && (
          <StatCard
            className={`afterplay-game-playthroughs relative mt-4 overflow-hidden ${revealClass}`}
          >
            <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-extrabold text-foreground">Every run</span>
                <small className="text-[10.5px] text-white/[0.34]">
                  How each playthrough stacks up
                </small>
              </div>
              <strong className="text-[32px] leading-[0.8] font-[950] text-white/[0.18]">
                {game.iterations.length}
              </strong>
            </div>
            <div className="afterplay-game-playthrough-list flex flex-col gap-2">
              {game.iterations.map((iteration, index) => {
                const iterationStatus = getGameStatusMeta(iteration.currentState);
                const dates = `${
                  iteration.startedAt ? formatDateOnly(iteration.startedAt, 'day') : '—'
                } → ${iteration.endedAt ? formatDateOnly(iteration.endedAt, 'day') : 'ongoing'}`;
                return (
                  <div
                    key={iteration.id}
                    className={cn(
                      'afterplay-game-playthrough',
                      'relative grid min-h-14.5 grid-cols-[45px_minmax(0,_1fr)] items-center overflow-hidden rounded-[10px]',
                      '[--run-color:var(--primary)] border border-white/[0.055] bg-white/[0.022]',
                      'hover:border-[color-mix(in_srgb,var(--run-color)_24%,rgba(255,255,255,0.05))] hover:bg-white/[0.032]',
                      'hover:transform-[translateX(3px)]',
                      '[transition:transform_260ms_cubic-bezier(0.22,1,0.36,1),border-color_200ms_ease,background-color_200ms_ease]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    style={{ '--run-color': iterationStatus.color } as CSSProperties}
                  >
                    <span className="afterplay-game-playthrough-index border-r border-r-white/[0.055] z-2 self-stretch pt-5 text-center text-[9px] font-black text-white/[0.22]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={cn(
                        'afterplay-game-playthrough-fill',
                        'origin-left absolute top-0 bottom-0 left-11.25 z-0',
                        'border-r border-r-[color-mix(in_srgb,var(--run-color)_60%,transparent)]',
                        '[background:linear-gradient(90deg,color-mix(in_srgb,var(--run-color)_15%,transparent),transparent)]',
                        'animate-[afterplay-game-run-in_750ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
                        'motion-reduce:animate-none motion-reduce:transition-none',
                      )}
                      style={{
                        width: `${Math.max(2, (iteration.hours / maxIterationHours) * 100)}%`,
                      }}
                    />
                    <div className="afterplay-game-playthrough-copy z-1 flex min-w-0 items-center justify-between gap-3.5 px-3.5 py-2.5">
                      <div className="grid min-w-0 grid-cols-[auto_minmax(0,_1fr)] items-center gap-x-1.5">
                        <StatusIcon meta={iterationStatus} size={13} />
                        <span className="truncate text-[12px] font-[750] text-foreground">
                          {iteration.label}
                        </span>
                        <small className="col-start-2 text-[9.5px] text-white/[0.34]">
                          {dates}
                        </small>
                      </div>
                      <strong className="flex-none text-[11px] font-extrabold text-(--run-color)">
                        {formatHours(iteration.hours)}{' '}
                        <i className="text-white/[0.22] not-italic">·</i>{' '}
                        {formatMoney(iteration.spend)}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </StatCard>
        )}

        <div className={revealClass} style={revealStyle(3)}>
          <GameChapter
            number="02"
            title="YOUR SIGNATURE"
            description="What makes this game different in your library"
          />
          <div className="afterplay-game-insight-grid [@media(760px<width<=1040px)]:grid-cols-[minmax(0,1fr)] [@media(width<=760px)]:grid-cols-[minmax(0,1fr)] grid grid-cols-[minmax(0,_1.06fr)_minmax(0,_0.94fr)] gap-4">
            <StatCard
              className={cn(
                'afterplay-game-library-card',
                'relative flex h-full flex-col overflow-hidden',
                'border-white/[0.075] shadow-[inset_0_1px_rgba(255,255,255,0.025)]',
                '[background:radial-gradient(circle_at_14%_22%,rgba(47,220,126,0.07),transparent_35%),var(--card)]',
              )}
            >
              <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-extrabold text-foreground">
                    Vs your library
                  </span>
                  <small className="text-[10.5px] text-white/[0.34]">
                    The weight this game carries
                  </small>
                </div>
                <Trophy className="mt-0.5 text-primary opacity-[0.72]" size={17} />
              </div>

              <div className="afterplay-game-library-stage grid grid-cols-[124px_minmax(0,_1fr)] items-center gap-5.5 px-0.75 pt-1.25 pb-4.25">
                <ShareRing pct={sharePct} />
                <div className="afterplay-game-library-rank flex min-w-0 flex-col">
                  <span className="text-[8px] font-black tracking-[0.13em] text-white/[0.32]">
                    PLAYTIME POSITION
                  </span>
                  <strong className="mt-0.5 text-[41px] leading-none font-[950] tracking-[-0.06em] text-foreground">
                    {rankLabel}
                  </strong>
                  <small className="mt-1 text-[10.5px] text-white/[0.39]">
                    out of {allGames.length} games
                  </small>
                </div>
              </div>

              {compareLines.length > 0 && (
                <div
                  className={cn(
                    'afterplay-game-comparisons',
                    'mt-auto flex flex-col gap-1.75 pt-3.25',
                    'border-t border-t-white/[0.055]',
                    '[&>div]:border [&>div]:border-white/[0.045] [&>div]:bg-white/[0.018]',
                    '[&>div]:[transition:border-color_180ms_ease,transform_220ms_cubic-bezier(0.22,1,0.36,1)]',
                    '[&>div:hover]:border-[rgba(47,220,126,0.16)] [&>div:hover]:transform-[translateX(3px)]',
                    'motion-reduce:[&>div]:animate-none motion-reduce:[&>div]:transition-none',
                  )}
                >
                  {compareLines.map((line) => (
                    <div
                      className="flex items-center gap-2 rounded-[8px] px-2.25 py-1.75 text-[10.5px] text-white/[0.65]"
                      key={line.key}
                    >
                      <Sparkles className="flex-none text-primary opacity-[0.72]" size={12} />
                      <span>{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </StatCard>

            <StatCard className="afterplay-game-records-card border-white/[0.075] shadow-[inset_0_1px_rgba(255,255,255,0.025)] [background:radial-gradient(circle_at_100%_0%,rgba(232,93,114,0.055),transparent_37%),var(--card)]">
              <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-extrabold text-foreground">
                    Session records
                  </span>
                  <small className="text-[10.5px] text-white/[0.34]">
                    The peaks hidden in your playtime
                  </small>
                </div>
                <Flame className="mt-0.5 text-[#e85d72] opacity-[0.72]" size={17} />
              </div>
              <div className="afterplay-game-record-grid grid grid-cols-2 gap-2">
                <RecordTile
                  Icon={Clock}
                  label="Average length"
                  value={formatElapsed(avgSessionSec)}
                  accent={GREEN}
                />
                <RecordTile
                  Icon={Flame}
                  label="Longest session"
                  value={formatElapsed(longestSessionSec)}
                  accent="#e85d72"
                />
                <RecordTile
                  Icon={Trophy}
                  label="Biggest day"
                  value={records.biggestDay ? formatHours(records.biggestDay.seconds / 3600) : '—'}
                  detail={biggestDayDate}
                  accent={AMBER}
                />
                <RecordTile
                  Icon={Gauge}
                  label="Longest streak"
                  value={pluralize(longestDailyStreak, 'day')}
                  accent={VIOLET}
                />
                <RecordTile
                  Icon={CalendarDays}
                  label="Days played"
                  value={pluralize(records.daysPlayed, 'day')}
                  accent={BLUE}
                />
                <RecordTile
                  Icon={Medal}
                  label="Busiest month"
                  value={
                    records.busiestMonth ? formatHours(records.busiestMonth.seconds / 3600) : '—'
                  }
                  detail={busiestMonthDate}
                  accent={GREEN}
                />
              </div>
            </StatCard>
          </div>
        </div>

        <div
          className={cn(
            'afterplay-game-signature-grid',
            'mt-4 grid grid-cols-[1.45fr_1fr] gap-4',
            '[&>*]:min-w-0 [&>*]:h-full',
            '[@media(760px<width<=1040px)]:grid-cols-[minmax(0,1fr)]',
            '[@media(width<=760px)]:grid-cols-[minmax(0,1fr)]',
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
          <GameDataCard>
            <TimeOfDayCard sessions={realSessions} />
          </GameDataCard>
        </div>

        <div className={`afterplay-game-hltb relative mt-4 ${revealClass}`} style={revealStyle(5)}>
          <HowLongToBeatCard
            game={game}
            markerHours={game.totalHours}
            markerScope="total"
            variant="dossier"
          />
        </div>

        <div className={revealClass} style={revealStyle(6)}>
          <GameChapter
            number="03"
            title="PLAY RHYTHM"
            description="When, how often and for how long you return"
          />
          <GameDataCard>
            <ActivityHeatmap
              sessions={realSessions}
              title="Activity — this game"
              year={effectiveHeatmapYear}
              yearPicker={
                <YearPicker
                  years={heatmapYears}
                  value={effectiveHeatmapYear}
                  onChange={setHeatmapYear}
                  compact
                  includeAllTime={false}
                />
              }
            />
          </GameDataCard>
        </div>

        <div
          className={`afterplay-game-chart-grid [@media(width<=760px)]:grid-cols-[minmax(0,1fr)] mt-4 grid grid-cols-2 gap-4 ${revealClass}`}
          style={revealStyle(7)}
        >
          <GameDataCard>
            <WhenDoYouPlayChart sessions={realSessions} year="all" title="When do you play it?" />
          </GameDataCard>
          <GameDataCard>
            <SessionLengthHistogram sessions={realSessions} year="all" />
          </GameDataCard>
        </div>
      </div>
    </div>
  );
};
