import {
  ArrowRight,
  Clock,
  DollarSign,
  Gamepad2,
  Gauge,
  Calendar as SessionsIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { useImageSrc } from '../hooks/useImageSrc';
import { useGame, useGames } from '../hooks/games';
import { formatElapsed, formatHours, formatMoney } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';

type GameStatsProps = {
  gameId: number;
  onOpenGame: () => void;
  onClearFilter: () => void;
};

const outlineButtonClass =
  'flex items-center gap-1.75 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap';

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
  const coverSrc = useImageSrc(game?.coverUrl ?? null, 'covers');

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
  const heatmapYears = useMemo(() => {
    const set = new Set<number>();
    for (const session of realSessions) set.add(session.startedAt.getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [realSessions]);
  // Propio de esta card, independiente del año que esté elegido (si acaso)
  // en la página global de Stats. Sin "All Time" aquí (ver YearPicker).
  // Mientras el usuario no toque el desplegable (null), se muestra el año
  // MÁS RECIENTE con sesiones de este juego — no el año actual a secas,
  // que podría salir vacío (y ni siquiera estar entre las opciones) si el
  // juego no se ha jugado este año.
  const [heatmapYear, setHeatmapYear] = useState<Year | null>(null);
  const effectiveHeatmapYear = heatmapYear ?? heatmapYears[0] ?? new Date().getFullYear();
  const closedRealSessions = realSessions.filter((session) => session.endedAt !== null);
  const longestSessionSec = closedRealSessions.reduce(
    (max, session) => Math.max(max, session.durationSec ?? 0),
    0,
  );
  const avgSessionSec =
    closedRealSessions.length > 0
      ? closedRealSessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) /
        closedRealSessions.length
      : 0;

  const ranked = [...allGames].sort((a, b) => b.totalHours - a.totalHours);
  const rankIndex = ranked.findIndex((g) => g.id === gameId);
  const libraryTotalHours = allGames.reduce((sum, g) => sum + g.totalHours, 0);
  const sharePct = game && libraryTotalHours > 0 ? (game.totalHours / libraryTotalHours) * 100 : 0;
  const maxIterationHours = Math.max(1, ...(game?.iterations.map((it) => it.hours) ?? [1]));

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (isError || !game) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">Couldn&apos;t load stats for this game.</p>
        <button
          type="button"
          onClick={onClearFilter}
          className="rounded-[10px] border border-input bg-white/3 px-4 py-2 text-[13px] font-semibold text-foreground"
        >
          Back to all games
        </button>
      </div>
    );
  }

  const status = getGameStatusMeta(game.currentState);

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-end justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.75">
            <div className="h-15.25 w-11.5 flex-none overflow-hidden rounded-[8px] border border-border">
              {coverSrc ? (
                <img src={coverSrc} loading="lazy" alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted">
                  <Gamepad2 size={16} className="text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-extrabold tracking-[-.01em] text-foreground">
                {game.title}
              </h1>
              <div className="mt-1 flex items-center gap-1.75">
                <status.Icon
                  size={14}
                  color={status.color}
                  fill={status.filled ? status.color : 'none'}
                />
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
            value={String(game.iterations.reduce((sum, it) => sum + it.sessions.length, 0))}
          />
          <MetricCard Icon={DollarSign} label="TOTAL SPENT" value={formatMoney(game.totalSpend)} />
        </div>

        <div className="mt-4.5 grid grid-cols-[1.4fr_1fr] gap-4.5">
          <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
            <div className="text-[14px] font-bold text-foreground">Share of your playtime</div>
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
          </div>

          <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
            <div className="mb-3.5 text-[14px] font-bold text-foreground">Sessions</div>
            <div className="flex items-center justify-between border-b border-white/5 py-2">
              <span className="text-[12.5px] text-muted-foreground">Average length</span>
              <span className="text-[14px] font-bold tabular-nums text-foreground">
                {formatElapsed(avgSessionSec)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12.5px] text-muted-foreground">Longest</span>
              <span className="text-[14px] font-bold tabular-nums text-foreground">
                {formatElapsed(longestSessionSec)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4.5">
          <HowLongToBeatCard game={game} markerHours={game.totalHours} markerScope="total" />
        </div>

        <div className="mt-4.5">
          <ActivityHeatmap
            sessions={allSessions}
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
          <div className="mt-4.5 rounded-[14px] border border-border bg-card px-5.5 py-5">
            <div className="mb-4.5 text-[14px] font-bold text-foreground">Time per playthrough</div>
            <div className="flex flex-col gap-3.75">
              {game.iterations.map((iteration) => {
                const iterationStatus = getGameStatusMeta(iteration.currentState);
                return (
                  <div key={iteration.id} className="flex items-center gap-3.25">
                    <div className="flex w-45 flex-none items-center gap-2">
                      <iterationStatus.Icon
                        size={14}
                        color={iterationStatus.color}
                        fill={iterationStatus.filled ? iterationStatus.color : 'none'}
                      />
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
          </div>
        )}
      </div>
    </div>
  );
};
