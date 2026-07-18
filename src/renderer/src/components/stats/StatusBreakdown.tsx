import { Info } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem, StateEvent, StateEventSummary } from '../../../../shared/types';
import { STATE_TO_STATUS_KEY, STATUS_META, type StatusKey } from '../../lib/gameStatus';
import { pluralize } from '../../lib/format';
import { StatusIcon } from '../StatusIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';

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
  const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
  const hovered = bars.find((bar) => bar.key === hoveredKey) ?? null;

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold text-foreground">
            {props.mode === 'all-time' ? 'Status Breakdown' : 'Status Changes'}
          </span>
          <Tooltip>
            <TooltipTrigger>
              <Info size={12} className="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              {props.mode === 'all-time'
                ? "Snapshot of every game's CURRENT status right now — one game, one bar, always."
                : `How many times each status was reached in ${props.year} — a game replayed and completed twice that year counts twice, and this counts TRANSITIONS, not how many games are in that status now.`}
            </TooltipContent>
          </Tooltip>
        </div>
        {/* Con un tramo/fila bajo el ratón, el resumen de la derecha se
            convierte en SU detalle (nombre · nº · %) — si no, el total. */}
        {total > 0 &&
          (hovered && hovered.count > 0 ? (
            <div
              className="text-[11.5px] font-semibold tabular-nums"
              style={{ color: hovered.meta.color }}
            >
              {hovered.label} · {hovered.count} · {Math.round((hovered.count / total) * 100)}%
            </div>
          ) : (
            <div className="text-[11.5px] text-muted-foreground tabular-nums">
              {props.mode === 'all-time' ? pluralize(total, 'game') : pluralize(total, 'change')}
            </div>
          ))}
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing here yet.</p>
      ) : (
        <>
          {/* Barra apilada de proporciones (estilo lenguajes de GitHub) —
              el reparto entero de un vistazo, cada tramo con el color de su
              estado. Los estados a cero no pintan tramo. */}
          <div className="mb-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {bars
              .filter((bar) => bar.count > 0)
              .map((bar) => (
                <div
                  key={bar.key}
                  onMouseEnter={() => setHoveredKey(bar.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className="transition-[width,opacity] duration-500"
                  style={{
                    width: `${(bar.count / total) * 100}%`,
                    background: bar.meta.color,
                    opacity: hoveredKey !== null && hoveredKey !== bar.key ? 0.35 : 1,
                  }}
                />
              ))}
          </div>

          <div className="flex flex-1 flex-col justify-center gap-3.5">
            {bars.map((bar) => {
              const isDimmed = hoveredKey !== null && hoveredKey !== bar.key;
              return (
                <div
                  key={bar.key}
                  onMouseEnter={() => setHoveredKey(bar.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className="flex items-center gap-2.5 transition-opacity duration-200"
                  style={{ opacity: isDimmed ? 0.45 : bar.count === 0 ? 0.5 : 1 }}
                >
                  {/* Chip del icono con el color del estado — mismo lenguaje
                      que los nodos de la línea temporal del History. */}
                  <span
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] border"
                    style={{
                      background: `${bar.meta.color}1f`,
                      borderColor: `${bar.meta.color}59`,
                    }}
                  >
                    <StatusIcon meta={bar.meta} size={14} />
                  </span>
                  <span
                    className="w-24 flex-none text-[13px] font-semibold"
                    style={{ color: bar.meta.color }}
                  >
                    {bar.label}
                  </span>
                  <div className="h-1.75 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${(bar.count / maxCount) * 100}%`,
                        background: `linear-gradient(90deg, ${bar.meta.color}, ${bar.meta.color}99)`,
                      }}
                    />
                  </div>
                  <span className="w-8 flex-none text-right text-[14px] font-bold text-foreground tabular-nums">
                    {bar.count}
                  </span>
                  <span className="w-9 flex-none text-right text-[11px] text-muted-foreground tabular-nums">
                    {Math.round((bar.count / total) * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </StatCard>
  );
};
