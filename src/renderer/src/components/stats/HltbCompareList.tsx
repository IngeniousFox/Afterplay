import { cn } from '../../lib/utils';
import { ArrowDownRight, ArrowUpRight, Gauge, Info, Minus } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { formatHours } from '../../lib/format';
import { GameCover } from '../GameCover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import { StatsPager } from './StatsPager';
import { usePagedYear } from './usePagedYear';
import type { Year } from './YearPicker';

type CompareSession = {
  iterationId: number;
  durationSec: number | null;
};

type HltbCompareListProps = {
  games: GameListItem[];
  stateEvents: StateEventSummary[];
  // Para sumar las horas trackeadas del playthrough completado — las
  // sesiones ya vienen sin marcadores de borde (getAllSessions).
  sessions: CompareSession[];
  year: Year;
  onOpenGame: (gameId: number) => void;
};

const MAX_ENTRIES = 6;
const BAR_SCALE = 2;
const ROW_HEIGHT_PX = 50;
const ROW_GAP_PX = 8;
const FAST_COLOR = '#2fdc7e';
const SAVOR_COLOR = '#e3b24a';

export const HltbCompareList = ({
  games,
  stateEvents,
  sessions,
  year,
  onOpenGame,
}: HltbCompareListProps): React.JSX.Element | null => {
  const { page, direction, goToPage } = usePagedYear(year);

  const entries = useMemo(() => {
    // El ÚLTIMO evento 'completed' de cada juego dentro de la ventana decide
    // qué playthrough se compara (desempate por id, como el resto de la app).
    const lastCompletedByGame = new Map<number, StateEventSummary>();
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      if (year !== 'all' && event.occurredAt.getFullYear() !== year) continue;
      const current = lastCompletedByGame.get(event.gameId);
      if (
        !current ||
        event.occurredAt.getTime() > current.occurredAt.getTime() ||
        (event.occurredAt.getTime() === current.occurredAt.getTime() && event.id > current.id)
      ) {
        lastCompletedByGame.set(event.gameId, event);
      }
    }

    const trackedSecondsByIteration = new Map<number, number>();
    for (const session of sessions) {
      trackedSecondsByIteration.set(
        session.iterationId,
        (trackedSecondsByIteration.get(session.iterationId) ?? 0) + (session.durationSec ?? 0),
      );
    }

    return games
      .filter(
        (game) => lastCompletedByGame.has(game.id) && game.hltbMain !== null && game.hltbMain > 0,
      )
      .flatMap((game) => {
        const completed = lastCompletedByGame.get(game.id);
        if (!completed) return [];
        const manual = game.manualIterations.find(
          (iteration) => iteration.iterationId === completed.iterationId,
        );
        const hours =
          (manual?.hours ?? 0) + (trackedSecondsByIteration.get(completed.iterationId) ?? 0) / 3600;
        if (hours <= 0) return [];
        return [
          {
            id: game.id,
            title: game.title,
            coverUrl: game.coverUrl,
            iterationLabel: completed.iterationLabel,
            hours,
            hltbMain: game.hltbMain as number,
            ratio: hours / (game.hltbMain as number),
          },
        ];
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [games, stateEvents, sessions, year]);

  const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES));
  const currentPage = Math.min(page, totalPages - 1);
  const shown = entries.slice(currentPage * MAX_ENTRIES, (currentPage + 1) * MAX_ENTRIES);
  // Tres filas como suelo visual; desde ahí crece con el contenido real.
  // Evita el enorme hueco de reservar seis filas cuando solo hay dos juegos.
  const visibleRowFloor = Math.max(3, shown.length);
  const listMinHeight =
    ROW_HEIGHT_PX * visibleRowFloor + ROW_GAP_PX * Math.max(0, visibleRowFloor - 1);

  // Mediana, no media: una única partida larguísima no debe definir cómo
  // juegas normalmente. Se calcula sobre todas las entradas, no la página.
  const medianRatio = useMemo(() => {
    if (entries.length === 0) return null;
    const sorted = entries.map((entry) => entry.ratio).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [entries]);

  const medianColor = medianRatio !== null && medianRatio <= 1 ? FAST_COLOR : SAVOR_COLOR;
  const medianDelta = medianRatio === null ? 0 : Math.round(Math.abs(medianRatio - 1) * 100);
  const medianLabel =
    medianRatio === null
      ? ''
      : medianRatio < 0.95
        ? `${medianDelta}% under Main Story`
        : medianRatio > 1.05
          ? `${medianDelta}% beyond Main Story`
          : 'Right on the Main Story estimate';
  const MedianIcon =
    medianRatio === null || (medianRatio >= 0.95 && medianRatio <= 1.05)
      ? Minus
      : medianRatio < 1
        ? ArrowDownRight
        : ArrowUpRight;

  return (
    <StatCard className="afterplay-hltb-card flex h-full flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-bold text-foreground">You vs HowLongToBeat</span>
            <Tooltip>
              <TooltipTrigger>
                <Info size={12} className="text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                Compares each game&apos;s last beaten playthrough against HLTB&apos;s Main Story
                time. The centre marker is the official estimate.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            Last completed playthroughs only
          </div>
        </div>
        <StatsPager
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={goToPage}
          prevLabel="Previous games"
          nextLabel="Next games"
        />
      </div>

      {medianRatio !== null && (
        <div
          className={cn(
            'afterplay-hltb-summary mt-4 flex items-center gap-[11px] min-h-15 py-2.5 px-3 rounded-[11px] border',
            'border-[color-mix(in_srgb,var(--hltb-accent)_22%,rgba(255,255,255,0.06))]',
            '[background:linear-gradient(120deg,color-mix(in_srgb,var(--hltb-accent)_10%,transparent),rgba(255,255,255,0.015))]',
          )}
          style={{ '--hltb-accent': medianColor } as CSSProperties}
        >
          <span
            className={cn(
              'afterplay-hltb-summary-icon flex w-8.5 h-8.5 flex-none items-center justify-center rounded-[9px] border',
              'border-[color-mix(in_srgb,var(--hltb-accent)_28%,transparent)]',
              'text-[color:var(--hltb-accent)]',
              'bg-[color-mix(in_srgb,var(--hltb-accent)_9%,transparent)]',
            )}
          >
            <Gauge size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black tracking-[.16em] text-white/45 uppercase">
              Your typical finish
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <strong
                className={cn(
                  'text-[23px] leading-none font-black tracking-[-.04em] tabular-nums',
                  'text-[color:var(--hltb-accent)]',
                )}
              >
                {medianRatio.toFixed(1)}×
              </strong>
              <span className="truncate text-[11px] font-semibold text-muted-foreground">
                {medianLabel}
              </span>
            </div>
          </div>
          <MedianIcon
            size={17}
            className="afterplay-hltb-direction text-[color:var(--hltb-accent)]"
          />
        </div>
      )}

      <div
        className={cn(
          'afterplay-hltb-scale mt-3.5 flex justify-between ml-12 py-0 px-px text-[11px] font-extrabold tracking-[0.08em]',
          'uppercase text-white/45 [&_span:nth-child(2)]:text-white/52 [&_span:nth-child(2)]:[transform:translateX(5px)]',
        )}
        aria-hidden="true"
      >
        <span>0×</span>
        <span>Main Story</span>
        <span>2×+</span>
      </div>

      <div className="flex flex-1 flex-col" style={{ minHeight: listMinHeight }}>
        {shown.length === 0 ? (
          <StatCardEmpty>
            No completed games with HowLongToBeat data{year === 'all' ? '' : ` in ${year}`} yet.
          </StatCardEmpty>
        ) : (
          <div
            key={currentPage}
            className={`flex flex-col justify-start gap-2 duration-300 animate-in fade-in-0 ${
              direction > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
            }`}
          >
            {shown.map((entry) => {
              const color = entry.ratio <= 1 ? FAST_COLOR : SAVOR_COLOR;
              const fillPercent = Math.min(1, entry.ratio / BAR_SCALE) * 100;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpenGame(entry.id)}
                  className={cn(
                    'afterplay-hltb-row group flex h-[50px] w-full items-center gap-3 text-left pt-px pr-1 pb-px pl-0 rounded-[9px]',
                    'outline-none [transition:transform_260ms_cubic-bezier(0.22,1,0.36,1),background-color_200ms_ease]',
                    '[&:is(:hover,:focus-visible)]:bg-white/[0.025] [&:is(:hover,:focus-visible)]:[transform:translateX(3px)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  style={{ '--hltb-accent': color } as CSSProperties}
                  aria-label={`Open ${entry.title}`}
                >
                  <GameCover
                    url={entry.coverUrl}
                    className={cn(
                      'afterplay-hltb-cover h-12 w-9 flex-none overflow-hidden rounded-[6px] border border-border',
                      '[transition:border-color_200ms_ease,box-shadow_240ms_ease,transform_280ms_cubic-bezier(0.22,1,0.36,1)]',
                      '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:border-[color-mix(in_srgb,var(--hltb-accent)_44%,transparent)]',
                      '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:[box-shadow:0_7px_16px_rgba(0,0,0,0.3)]',
                      '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:[transform:translateY(-1px)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    iconSize={15}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-bold text-foreground">
                          {entry.title}
                        </div>
                        <div className="mt-0.25 text-[11px] text-muted-foreground tabular-nums">
                          You {formatHours(entry.hours)} · HLTB {formatHours(entry.hltbMain)}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'afterplay-hltb-ratio flex-none min-w-[39px] py-0.5 px-[5px] rounded-[6px] text-[11.5px] font-[850] text-center',
                          'border border-[color-mix(in_srgb,var(--hltb-accent)_20%,rgba(255,255,255,0.06))]',
                          'text-[color:var(--hltb-accent)]',
                          'bg-[color-mix(in_srgb,var(--hltb-accent)_7%,rgba(0,0,0,0.22))]',
                          '[transition:border-color_180ms_ease,background-color_180ms_ease]',
                          '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:border-[color-mix(in_srgb,var(--hltb-accent)_42%,transparent)]',
                          '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:bg-[color-mix(in_srgb,var(--hltb-accent)_12%,rgba(0,0,0,0.22))]',
                          'motion-reduce:animate-none motion-reduce:transition-none',
                        )}
                      >
                        {entry.ratio.toFixed(1)}×
                      </span>
                    </div>
                    <div className="afterplay-hltb-track mt-1.5 relative h-[5px] rounded-[99px] bg-white/[0.055]">
                      <span
                        className={cn(
                          'afterplay-hltb-fill absolute [inset:0_auto_0_0] rounded-[inherit]',
                          '[background:linear-gradient(90deg,color-mix(in_srgb,var(--hltb-accent)_45%,transparent),var(--hltb-accent))]',
                          '[box-shadow:0_0_9px_color-mix(in_srgb,var(--hltb-accent)_22%,transparent)] origin-left',
                          'animate-[afterplay-grow-x_650ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
                          'motion-reduce:animate-none motion-reduce:transition-none',
                        )}
                        style={{ width: `${fillPercent}%` }}
                      />
                      <span className="afterplay-hltb-marker absolute top-[-3px] bottom-[-3px] left-1/2 w-px bg-white/72 [box-shadow:0_0_5px_rgba(255,255,255,0.25)]" />
                      <span
                        className={cn(
                          'afterplay-hltb-point absolute top-1/2 w-2 h-2 rounded-[50%] border-2 border-[#111512] bg-[var(--hltb-accent)]',
                          '[box-shadow:0_0_9px_color-mix(in_srgb,var(--hltb-accent)_45%,transparent)] [transform:translate(-50%,-50%)]',
                          '[transition:box-shadow_200ms_ease]',
                          '[.afterplay-hltb-row:is(:hover,:focus-visible)_&]:[box-shadow:0_0_14px_color-mix(in_srgb,var(--hltb-accent)_65%,transparent)]',
                          'motion-reduce:animate-none motion-reduce:transition-none',
                        )}
                        style={{ left: `${fillPercent}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </StatCard>
  );
};
