import { Info } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem, StateEvent, StateEventSummary } from '../../../../shared/types';
import { STATE_TO_STATUS_KEY, STATUS_META, type StatusKey } from '../../lib/gameStatus';
import { pluralize } from '../../lib/format';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { ChartHeading, StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';

type StatusBreakdownProps =
  | { mode: 'all-time'; games: GameListItem[] }
  | { mode: 'year'; stateEvents: StateEventSummary[]; year: number };

// SPEC sección 8 — "All Time" es una FOTO (estado actual de cada juego);
// un año concreto son TRANSICIONES (cuántas veces se pasó a ese estado ese
// año) — dos preguntas distintas, por eso cambia hasta el título de la
// card. Unplayed no tiene transición (nunca hay un stateEvent "unplayed"),
// así que solo aparece en el modo All Time, nunca por año.
const ALL_TIME_KEYS: StatusKey[] = ['unplayed', 'playing', 'beaten', 'on_hold', 'dropped'];

const YEAR_ENTRIES: { type: StateEvent['type']; label: string }[] = [
  { type: 'started', label: 'Started' },
  { type: 'completed', label: 'Completed' },
  { type: 'dropped', label: 'Dropped' },
  { type: 'on_hold', label: 'Put on Hold' },
];

export const StatusBreakdown = (props: StatusBreakdownProps): React.JSX.Element => {
  // Fila (y tramo de la barra apilada) bajo el ratón — el hover se sincroniza
  // en los dos sentidos: pasar por un tramo resalta su fila y viceversa.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const bars =
    props.mode === 'all-time'
      ? ALL_TIME_KEYS.map((key) => ({
          key: key as string,
          label: STATUS_META[key].label,
          meta: STATUS_META[key],
          count: props.games.filter(
            (game) =>
              (game.currentState === null ? 'unplayed' : STATE_TO_STATUS_KEY[game.currentState]) ===
              key,
          ).length,
        }))
      : YEAR_ENTRIES.map(({ type, label }) => {
          const statusKey = STATE_TO_STATUS_KEY[type];
          return {
            key: type as string,
            label,
            meta: STATUS_META[statusKey],
            count: props.stateEvents.filter(
              (event) => event.type === type && event.occurredAt.getFullYear() === props.year,
            ).length,
          };
        });

  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  const hovered = bars.find((bar) => bar.key === hoveredKey) ?? null;

  return (
    <StatCard className="flex h-full flex-col">
      <ChartHeading
        title={
          <span className="inline-flex items-center gap-1.5">
            {props.mode === 'all-time' ? 'Status breakdown' : 'Status changes'}
            <Tooltip>
              <TooltipTrigger aria-label="About this card">
                <Info size={13} className="text-dust" />
              </TooltipTrigger>
              <TooltipContent>
                {props.mode === 'all-time'
                  ? "Snapshot of every game's current status right now: one game, one bar, always."
                  : `How many times each status was reached in ${props.year}. A game replayed and completed twice that year counts twice: these are transitions, not how many games are in that status now.`}
              </TooltipContent>
            </Tooltip>
          </span>
        }
        right={
          total > 0 &&
          (hovered && hovered.count > 0 ? (
            <span className="font-semibold" style={{ color: hovered.meta.color }}>
              {hovered.label} · {hovered.count} · {Math.round((hovered.count / total) * 100)}%
            </span>
          ) : props.mode === 'all-time' ? (
            pluralize(total, 'game')
          ) : (
            pluralize(total, 'change')
          ))
        }
      />

      {total === 0 ? (
        <div className="mt-4">
          <StatCardEmpty>Nothing here yet.</StatCardEmpty>
        </div>
      ) : (
        <>
          {/* Barra apilada de proporciones: el reparto entero de un vistazo,
              cada tramo con el color de su estado. Los estados a cero no
              pintan tramo. */}
          <div className="mt-4 mb-2 flex h-5 gap-0.5 overflow-hidden rounded-[2px]">
            {bars
              .filter((bar) => bar.count > 0)
              .map((bar) => (
                <div
                  key={bar.key}
                  onMouseEnter={() => setHoveredKey(bar.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className="transition-[width,opacity] duration-500 motion-reduce:transition-none"
                  style={{
                    width: `${(bar.count / total) * 100}%`,
                    background: bar.meta.color,
                    opacity: hoveredKey !== null && hoveredKey !== bar.key ? 0.35 : 1,
                  }}
                />
              ))}
          </div>

          <div className="flex flex-1 flex-col justify-center">
            {bars.map((bar) => {
              const isDimmed = hoveredKey !== null && hoveredKey !== bar.key;
              return (
                <div
                  key={bar.key}
                  onMouseEnter={() => setHoveredKey(bar.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className={cn(
                    'grid grid-cols-[10px_minmax(0,1fr)_auto_40px] items-center gap-3 border-b border-line py-2 last:border-b-0',
                    'rounded-sm transition-[opacity,background-color] duration-150 hover:bg-raised',
                  )}
                  style={{ opacity: isDimmed ? 0.45 : bar.count === 0 ? 0.5 : 1 }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{
                      background: bar.meta.color,
                      boxShadow: bar.count > 0 ? `0 0 6px ${bar.meta.color}99` : undefined,
                    }}
                  />
                  <span className="truncate text-body text-bone">{bar.label}</span>
                  <span className="font-display text-[24px] leading-none font-bold text-bone tabular-nums">
                    {bar.count}
                  </span>
                  <span className="text-right text-micro text-dust tabular-nums">
                    {Math.round((bar.count / total) * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
          {props.mode === 'all-time' && (
            <p className="mt-3 text-small text-dust">
              Pick a year and this counts transitions instead: started, completed, dropped, put on
              hold.
            </p>
          )}
        </>
      )}
    </StatCard>
  );
};
