import { ArrowRight, Clock, DollarSign, Gauge, Calendar as SessionsIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MetricCard } from '../components/library/detail/MetricsRow';
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
import { startOfDayMs, yearsDesc } from '../lib/dateMath';
import { formatDateOnly, formatElapsed, formatHours, formatMoney, pluralize } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { sessionDurationStats } from '../lib/sessionStats';
import { outlineButtonClass, revealClass, revealStyle } from '../lib/styles';
import { longestStreak, playedDayKeys } from '../lib/streaks';

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
    if (session.isManual || session.endedAt === null) continue;
    seconds[(session.startedAt.getDay() + 6) % 7] += session.durationSec ?? 0;
  }
  const max = Math.max(...seconds);
  return max > 0 ? seconds.indexOf(max) : null;
};

// Anillo de progreso del share — el mismo dato que el % gigante, pero con
// presencia visual (la barra horizontal de antes era invisible con shares
// pequeños).
const ShareRing = ({ pct }: { pct: number }): React.JSX.Element => {
  const size = 68;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Un share minúsculo (0.1%) pinta al menos un arco visible — el número al
  // lado ya dice la verdad exacta.
  const arc = Math.max(0.02, Math.min(1, pct / 100)) * circumference;
  return (
    <svg width={size} height={size} className="flex-none">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,.06)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#2fdc7e"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
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
  const heatmapYears = useMemo(
    () => yearsDesc(realSessions.map((session) => session.startedAt)),
    [realSessions],
  );
  // Propio de esta card, independiente del año que esté elegido (si acaso)
  // en la página global de Stats. Sin "All Time" aquí (ver YearPicker).
  // Mientras el usuario no toque el desplegable (null), se muestra el año
  // MÁS RECIENTE con sesiones de este juego — no el año actual a secas,
  // que podría salir vacío (y ni siquiera estar entre las opciones) si el
  // juego no se ha jugado este año.
  const [heatmapYear, setHeatmapYear] = useState<Year | null>(null);
  const effectiveHeatmapYear = heatmapYear ?? heatmapYears[0] ?? new Date().getFullYear();
  const { longestSec: longestSessionSec, avgSec: avgSessionSec } =
    sessionDurationStats(realSessions);
  // La racha más larga DE ESTE JUEGO, de todos los tiempos (aquí no hay
  // filtro de año — el del heatmap de abajo es solo suyo). Días con al menos
  // una sesión trackeada real, ver lib/streaks.ts.
  const longestDailyStreak = longestStreak(playedDayKeys(realSessions));

  // Récords: día más intenso, días distintos jugados, mes más cargado —
  // solo sesiones cerradas (las abiertas aún no tienen duración final).
  const records = useMemo(() => {
    const secondsByDay = new Map<number, number>();
    const secondsByMonth = new Map<number, number>();
    for (const session of realSessions) {
      if (session.endedAt === null) continue;
      const dayMs = startOfDayMs(session.startedAt);
      secondsByDay.set(dayMs, (secondsByDay.get(dayMs) ?? 0) + (session.durationSec ?? 0));
      const monthKey = session.startedAt.getFullYear() * 12 + session.startedAt.getMonth();
      secondsByMonth.set(
        monthKey,
        (secondsByMonth.get(monthKey) ?? 0) + (session.durationSec ?? 0),
      );
    }

    let biggestDay: { dayMs: number; seconds: number } | null = null;
    for (const [dayMs, seconds] of secondsByDay) {
      if (!biggestDay || seconds > biggestDay.seconds) biggestDay = { dayMs, seconds };
    }
    let busiestMonth: { monthKey: number; seconds: number } | null = null;
    for (const [monthKey, seconds] of secondsByMonth) {
      if (!busiestMonth || seconds > busiestMonth.seconds) busiestMonth = { monthKey, seconds };
    }

    return { biggestDay, busiestMonth, daysPlayed: secondsByDay.size };
  }, [realSessions]);

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

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      {/* key={game.id}: cambiar de juego remonta el árbol — la entrada
          escalonada y los contadores vuelven a animar. */}
      <div key={game.id} className="mx-auto max-w-250">
        {/* Cabecera con el hero del juego de fondo (desenfocado y oscurecido
            para que el texto siga mandando) — sin hero, la cabecera plana de
            siempre. */}
        <div
          className={
            heroSrc
              ? 'relative mb-6.5 overflow-hidden rounded-[16px] border border-border'
              : 'mb-6.5'
          }
        >
          {heroSrc && (
            <>
              <img
                src={heroSrc}
                alt=""
                className="absolute inset-0 h-full w-full scale-105 object-cover opacity-45 blur-[1.5px]"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(13,15,14,.94) 0%, rgba(13,15,14,.55) 55%, rgba(13,15,14,.9) 100%)',
                }}
              />
            </>
          )}
          <div
            className={`relative z-1 flex items-end justify-between gap-4 ${heroSrc ? 'px-5.5 py-5' : ''}`}
          >
            <div className="flex min-w-0 items-center gap-3.75">
              <GameCover
                url={game.coverUrl}
                className="h-15.25 w-11.5 flex-none overflow-hidden rounded-[8px] border border-border"
                iconSize={16}
              />
              <div className="min-w-0">
                <h1 className="truncate text-[24px] font-extrabold tracking-[-.01em] text-foreground">
                  {game.title}
                </h1>
                <div className="mt-1 flex items-center gap-1.75">
                  <StatusIcon meta={status} size={14} />
                  <span className="text-[13px] font-semibold" style={{ color: status.color }}>
                    {status.label}
                  </span>
                  <span className="text-[13px] text-muted-foreground">· personal statistics</span>
                </div>
              </div>
            </div>

            <div className="flex flex-none gap-2.5">
              <button
                type="button"
                onClick={onOpenGame}
                className={`${outlineButtonClass} border-primary/45 bg-primary/10 text-primary hover:bg-primary/16`}
              >
                <span>Open game</span>
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                onClick={onClearFilter}
                className={`${outlineButtonClass} border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]`}
              >
                All games
              </button>
            </div>
          </div>
        </div>

        <div
          className={`grid grid-cols-2 gap-3.5 sm:grid-cols-4 ${revealClass}`}
          style={revealStyle(0)}
        >
          {/* Valores animados (count-up): suben hasta el real al entrar. */}
          <MetricCard
            Icon={Clock}
            label="TOTAL HOURS"
            value={formatHours(animatedHours)}
            accent="#2fdc7e"
          />
          <MetricCard
            Icon={Gauge}
            label="COST / HOUR"
            value={game.costPerHour !== null ? formatMoney(animatedCost) : '—'}
            accent="#7c86c8"
          />
          <MetricCard
            Icon={SessionsIcon}
            label="SESSIONS"
            // realSessions y no la suma cruda: los marcadores de borde no son
            // sesiones jugadas, y la vista de Sesiones de este mismo juego
            // tampoco los cuenta — mismo número en las dos pantallas.
            value={String(Math.round(animatedSessions))}
            accent="#85a3d6"
          />
          <MetricCard
            Icon={DollarSign}
            label="TOTAL SPENT"
            value={formatMoney(animatedSpent)}
            accent="#e3b24a"
          />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(1)}>
          <GameJourneyCard
            addedAt={game.addedAt}
            stateHistory={game.stateHistory}
            sessions={realSessions}
          />
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.4fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(2)}
        >
          <StatCard title="Vs your library" className="flex h-full flex-col">
            <div className="mt-0.5 mb-4 text-xs text-muted-foreground">
              How much of your total hours went here
            </div>
            <div className="flex items-center gap-4">
              <ShareRing pct={sharePct} />
              <div>
                <div className="flex items-baseline gap-2.5">
                  <div className="text-[32px] font-extrabold text-primary tabular-nums">
                    {sharePct.toFixed(1)}%
                  </div>
                  <div className="text-[13px] text-muted-foreground">
                    · ranked {rankIndex >= 0 ? `#${rankIndex + 1} of ${allGames.length}` : '—'}
                  </div>
                </div>
                <div className="text-[11.5px] text-muted-foreground">of all your playtime</div>
              </div>
            </div>

            {compareLines.length > 0 && (
              <div className="mt-4 flex flex-1 flex-col justify-end gap-2 border-t border-white/5 pt-3.5">
                {compareLines.map((line) => (
                  <div key={line.key} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-primary/70" />
                    <span className="text-foreground">{line.text}</span>
                  </div>
                ))}
              </div>
            )}
          </StatCard>

          <StatCard title="Session records" titleClassName="mb-2">
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Average length</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {formatElapsed(avgSessionSec)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Longest session</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {formatElapsed(longestSessionSec)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Longest daily streak</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {pluralize(longestDailyStreak, 'day')}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Biggest day</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {records.biggestDay
                  ? `${formatHours(records.biggestDay.seconds / 3600)} · ${formatDateOnly(new Date(records.biggestDay.dayMs), 'day')}`
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Days played</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {pluralize(records.daysPlayed, 'day')}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12.5px] text-muted-foreground">Busiest month</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {records.busiestMonth
                  ? `${formatHours(records.busiestMonth.seconds / 3600)} · ${new Date(
                      Math.floor(records.busiestMonth.monthKey / 12),
                      records.busiestMonth.monthKey % 12,
                      1,
                    ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                  : '—'}
              </span>
            </div>
          </StatCard>
        </div>

        <div
          className={`mt-4.5 grid grid-cols-[1.4fr_1fr] gap-4.5 ${revealClass}`}
          style={revealStyle(3)}
        >
          <GameBadges
            totalHours={game.totalHours}
            totalSpent={game.totalSpend}
            longestSessionSec={longestSessionSec}
            longestStreakDays={longestDailyStreak}
            sessionCount={realSessions.length}
            beaten={everBeaten}
            hltbCompletionist={game.hltbCompletionist}
            sessions={realSessions}
          />
          <TimeOfDayCard sessions={realSessions} />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(4)}>
          <HowLongToBeatCard game={game} markerHours={game.totalHours} markerScope="total" />
        </div>

        <div className={`mt-4.5 ${revealClass}`} style={revealStyle(5)}>
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
        </div>

        <div className={`mt-4.5 grid grid-cols-2 gap-4.5 ${revealClass}`} style={revealStyle(6)}>
          <WhenDoYouPlayChart sessions={realSessions} year="all" title="When do you play it?" />
          <SessionLengthHistogram sessions={realSessions} year="all" />
        </div>

        {game.iterations.length > 1 && (
          <StatCard
            className={`mt-4.5 ${revealClass}`}
            title="Time per playthrough"
            titleClassName="mb-4.5"
          >
            <div className="flex flex-col gap-2">
              {game.iterations.map((iteration) => {
                const iterationStatus = getGameStatusMeta(iteration.currentState);
                const dates = `${
                  iteration.startedAt ? formatDateOnly(iteration.startedAt, 'day') : '—'
                } → ${iteration.endedAt ? formatDateOnly(iteration.endedAt, 'day') : 'ongoing'}`;
                return (
                  // Fila-barra (mismo estilo que Most Played), con el color
                  // del estado del playthrough como relleno.
                  <div
                    key={iteration.id}
                    className="relative h-12 overflow-hidden rounded-[9px] bg-white/[0.03]"
                  >
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${Math.max(2, (iteration.hours / maxIterationHours) * 100)}%`,
                        background: `linear-gradient(90deg, ${iterationStatus.color}38, ${iterationStatus.color}12)`,
                        borderRight: `2px solid ${iterationStatus.color}b3`,
                      }}
                    />
                    <div className="relative z-1 flex h-full items-center justify-between gap-3 px-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.75">
                          <StatusIcon meta={iterationStatus} size={13} />
                          <span className="truncate text-[13px] font-semibold text-foreground">
                            {iteration.label}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums">
                          {dates}
                        </div>
                      </div>
                      <span
                        className="flex-none text-[12.5px] font-bold tabular-nums"
                        style={{ color: iterationStatus.color }}
                      >
                        {formatHours(iteration.hours)} · {formatMoney(iteration.spend)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </StatCard>
        )}
      </div>
    </div>
  );
};
