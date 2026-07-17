import { ArrowRight, Clock, DollarSign, Gauge, Calendar as SessionsIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { StatCard } from '../components/stats/StatCard';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { GameCover } from '../components/GameCover';
import { StatusIcon } from '../components/StatusIcon';
import { useGame, useGames } from '../hooks/games';
import { yearsDesc } from '../lib/dateMath';
import { formatElapsed, formatHours, formatMoney, pluralize } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { sessionDurationStats } from '../lib/sessionStats';
import { outlineButtonClass } from '../lib/styles';
import { longestStreak, playedDayKeys } from '../lib/streaks';

type GameStatsProps = {
  gameId: number;
  onOpenGame: () => void;
  onClearFilter: () => void;
};

// Bloque 5F — stats de un único juego: mismas 4 métricas que el detalle,
// share de tu tiempo total + medias de sesión, el mismo widget de How Long
// To Beat, un heatmap solo de este juego, y (si hay más de un playthrough)
// las horas/gasto de cada uno lado a lado.
export const GameStats = ({
  gameId,
  onOpenGame,
  onClearFilter,
}: GameStatsProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
  const { data: allGames = [] } = useGames();

  // useAllSessions() ya trae todo esto, pero game.iterations (useGame) es la
  // misma info sin un segundo viaje — el detalle de un juego ya la trae
  // completa, no hace falta pedirla dos veces.
  const allSessions = useMemo(() => game?.iterations.flatMap((it) => it.sessions) ?? [], [game]);
  // Los marcadores de borde (milestone no nulo, duración 0 — ver
  // createGameWithDetails.ts) no son sesiones que nadie jugó; fuera para
  // medias/heatmap, igual que en SessionHistoryList/getAllSessions.
  const realSessions = useMemo(
    () => allSessions.filter((session) => session.milestone === null),
    [allSessions],
  );
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

  const ranked = [...allGames].sort((a, b) => b.totalHours - a.totalHours);
  const rankIndex = ranked.findIndex((g) => g.id === gameId);
  const libraryTotalHours = allGames.reduce((sum, g) => sum + g.totalHours, 0);
  const sharePct = game && libraryTotalHours > 0 ? (game.totalHours / libraryTotalHours) * 100 : 0;
  const maxIterationHours = Math.max(1, ...(game?.iterations.map((it) => it.hours) ?? [1]));

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

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-end justify-between gap-4">
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

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <MetricCard Icon={Clock} label="TOTAL HOURS" value={formatHours(game.totalHours)} />
          <MetricCard
            Icon={Gauge}
            label="COST / HOUR"
            value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
          />
          <MetricCard
            Icon={SessionsIcon}
            label="SESSIONS"
            // realSessions y no la suma cruda: los marcadores de borde no son
            // sesiones jugadas, y la vista de Sesiones de este mismo juego
            // tampoco los cuenta — mismo número en las dos pantallas.
            value={String(realSessions.length)}
          />
          <MetricCard Icon={DollarSign} label="TOTAL SPENT" value={formatMoney(game.totalSpend)} />
        </div>

        <div className="mt-4.5 grid grid-cols-[1.4fr_1fr] gap-4.5">
          <StatCard title="Share of your playtime">
            <div className="mt-0.5 mb-4 text-xs text-muted-foreground">
              How much of your total hours went here
            </div>
            <div className="flex items-baseline gap-2.5">
              <div className="text-[32px] font-extrabold text-primary tabular-nums">
                {sharePct.toFixed(1)}%
              </div>
              <div className="text-[13px] text-muted-foreground">
                · ranked {rankIndex >= 0 ? `#${rankIndex + 1} of ${allGames.length}` : '—'}
              </div>
            </div>
            <div className="mt-3.5 h-2.25 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, sharePct)}%`,
                  background: 'linear-gradient(90deg,var(--ac2),var(--ac))',
                }}
              />
            </div>
          </StatCard>

          <StatCard title="Sessions" titleClassName="mb-3.5">
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Average length</span>
              <span className="text-[14px] font-bold tabular-nums text-foreground">
                {formatElapsed(avgSessionSec)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Longest</span>
              <span className="text-[14px] font-bold tabular-nums text-foreground">
                {formatElapsed(longestSessionSec)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12.5px] text-muted-foreground">Longest daily streak</span>
              <span className="text-[14px] font-bold tabular-nums text-foreground">
                {pluralize(longestDailyStreak, 'day')}
              </span>
            </div>
          </StatCard>
        </div>

        <div className="mt-4.5">
          <HowLongToBeatCard game={game} markerHours={game.totalHours} markerScope="total" />
        </div>

        <div className="mt-4.5">
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

        {game.iterations.length > 1 && (
          <StatCard className="mt-4.5" title="Time per playthrough" titleClassName="mb-4.5">
            <div className="flex flex-col gap-3.75">
              {game.iterations.map((iteration) => {
                const iterationStatus = getGameStatusMeta(iteration.currentState);
                return (
                  <div key={iteration.id} className="flex items-center gap-3.25">
                    <div className="flex w-45 flex-none items-center gap-2">
                      <StatusIcon meta={iterationStatus} size={14} />
                      <span className="truncate text-[13.5px] font-semibold text-foreground">
                        {iteration.label}
                      </span>
                    </div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(iteration.hours / maxIterationHours) * 100}%`,
                          background: 'linear-gradient(90deg,var(--ac2),var(--ac))',
                        }}
                      />
                    </div>
                    <div className="w-30 flex-none text-right text-[12.5px] text-muted-foreground tabular-nums">
                      {formatHours(iteration.hours)} · {formatMoney(iteration.spend)}
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
