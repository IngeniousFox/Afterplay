import { cn } from '../../lib/utils';
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { useMemo } from 'react';
import type { SessionStats } from '../../../../shared/domain/sessionStats';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { formatHours, pluralize } from '../../lib/format';
import { GameCover } from '../GameCover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { ChartHeading, StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import { StatsPager } from './StatsPager';
import { usePagedYear } from './usePagedYear';
import type { Year } from './YearPicker';
import { compareByCreation, type GameId, type IterationId } from '../../../../shared/entityIds';

type HltbCompareListProps = {
  games: GameListItem[];
  stateEvents: StateEventSummary[];
  // Para sumar las horas trackeadas del playthrough completado: los segundos
  // medidos de cada playthrough, que calcula el main (F-41).
  stats: Pick<SessionStats, 'iterationSeconds'>;
  year: Year;
  onOpenGame: (gameId: GameId) => void;
};

const MAX_ENTRIES = 6;
const BAR_SCALE = 2;
const ROW_HEIGHT_PX = 50;
const ROW_GAP_PX = 8;

export const HltbCompareList = ({
  games,
  stateEvents,
  stats,
  year,
  onOpenGame,
}: HltbCompareListProps): React.JSX.Element | null => {
  const { page, direction, goToPage } = usePagedYear(year);

  const entries = useMemo(() => {
    // El ÚLTIMO evento 'completed' de cada juego dentro de la ventana decide
    // qué playthrough se compara (desempate por id, como el resto de la app).
    const lastCompletedByGame = new Map<GameId, StateEventSummary>();
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      if (year !== 'all' && event.occurredAt.getFullYear() !== year) continue;
      const current = lastCompletedByGame.get(event.gameId);
      if (
        !current ||
        event.occurredAt.getTime() > current.occurredAt.getTime() ||
        (event.occurredAt.getTime() === current.occurredAt.getTime() &&
          compareByCreation(event.id, current.id) > 0)
      ) {
        lastCompletedByGame.set(event.gameId, event);
      }
    }

    const trackedSecondsByIteration = new Map<IterationId, number>();
    for (const entry of stats.iterationSeconds) {
      trackedSecondsByIteration.set(
        entry.iterationId,
        (trackedSecondsByIteration.get(entry.iterationId) ?? 0) + entry.seconds,
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
  }, [games, stateEvents, stats, year]);

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
      <ChartHeading
        title={
          <span className="inline-flex items-center gap-1.5">
            You vs HowLongToBeat
            <Tooltip>
              <TooltipTrigger aria-label="About this comparison">
                <Info size={13} className="text-dust" />
              </TooltipTrigger>
              <TooltipContent>
                Compares each game&apos;s last beaten playthrough against HLTB&apos;s Main Story
                time. The marker is the official estimate.
              </TooltipContent>
            </Tooltip>
          </span>
        }
        subtitle="Last completed playthroughs only"
        right={
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-[2px] bg-phosphor" aria-hidden="true" /> Your time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-3 w-0.5 bg-tube" aria-hidden="true" /> Main Story
            </span>
            <StatsPager
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={goToPage}
              prevLabel="Previous games"
              nextLabel="Next games"
            />
          </div>
        }
      />

      {medianRatio !== null && (
        <div className="afterplay-hltb-summary mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
          <span className="text-small text-dust">Your typical finish</span>
          <strong className="font-display text-[34px] leading-none font-bold text-phosphor tabular-nums">
            {medianRatio.toFixed(1)}×
          </strong>
          <span className="inline-flex items-center gap-1 text-small text-dust">
            <MedianIcon size={14} className="afterplay-hltb-direction text-phosphor" />
            {medianLabel}, median of {pluralize(entries.length, 'finished game')}
          </span>
        </div>
      )}

      <div
        className="afterplay-hltb-scale mt-3 grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_150px] gap-4 text-micro text-dust"
        aria-hidden="true"
      >
        <span />
        <span className="relative flex justify-between">
          <span>0×</span>
          <span className="absolute left-1/2 -translate-x-1/2 text-tube">Main Story</span>
          <span>2×+</span>
        </span>
        <span />
      </div>

      <div className="flex flex-1 flex-col" style={{ minHeight: listMinHeight }}>
        {shown.length === 0 ? (
          <StatCardEmpty>
            No completed games with HowLongToBeat data{year === 'all' ? '' : ` in ${year}`} yet.
          </StatCardEmpty>
        ) : (
          <div
            key={currentPage}
            className={`flex flex-col justify-start gap-2 duration-300 animate-in fade-in-0 motion-reduce:animate-none ${
              direction > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
            }`}
          >
            {shown.map((entry) => {
              const fillPercent = Math.min(1, entry.ratio / BAR_SCALE) * 100;
              const delta = Math.round(Math.abs(entry.ratio - 1) * 100);
              const verdict =
                entry.ratio < 0.95
                  ? `${delta}% under Main Story`
                  : entry.ratio > 1.05
                    ? `${delta}% beyond Main Story`
                    : 'Right on Main Story';
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpenGame(entry.id)}
                  className={cn(
                    'afterplay-hltb-row group grid h-[50px] w-full grid-cols-[minmax(0,180px)_minmax(0,1fr)_150px] items-center gap-4 rounded-sm px-1 text-left',
                    'transition-colors duration-150 hover:bg-raised',
                    'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-phosphor',
                  )}
                  aria-label={`Open ${entry.title}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <GameCover
                      url={entry.coverUrl}
                      className="afterplay-hltb-cover h-11 w-8 flex-none overflow-hidden rounded-sm border border-line"
                      iconSize={14}
                    />
                    <span className="truncate text-body font-semibold text-bone">
                      {entry.title}
                    </span>
                  </span>
                  <span className="afterplay-hltb-track relative h-3 rounded-[2px] bg-inset">
                    <span
                      className={cn(
                        'afterplay-hltb-fill absolute inset-y-0 left-0 origin-left rounded-[2px] bg-phosphor',
                        'animate-[afterplay-grow-x_600ms_var(--ease-out)_backwards] motion-reduce:animate-none',
                      )}
                      style={{ width: `${fillPercent}%` }}
                    />
                    <span className="afterplay-hltb-marker absolute -top-1.5 -bottom-1.5 left-1/2 w-0.5 -translate-x-1/2 bg-tube shadow-[0_0_6px_var(--color-tube)]" />
                  </span>
                  <span className="min-w-0 text-right">
                    <span className="afterplay-hltb-ratio block text-small text-dust tabular-nums">
                      <strong className="font-semibold text-bone">
                        {formatHours(entry.hours)}
                      </strong>{' '}
                      vs {formatHours(entry.hltbMain)}
                    </span>
                    <span className="block text-micro text-dust">{verdict}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </StatCard>
  );
};
