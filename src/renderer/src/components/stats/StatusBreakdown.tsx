import type { GameListItem, StateEvent, StateEventSummary } from '../../../../shared/types';
import { STATE_TO_STATUS_KEY, STATUS_META, type StatusKey } from '../../lib/gameStatus';
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
  const bars =
    props.mode === 'all-time'
      ? ALL_TIME_KEYS.map((key) => ({
          key,
          label: STATUS_META[key].label,
          color: STATUS_META[key].color,
          Icon: STATUS_META[key].Icon,
          count: props.games.filter(
            (game) =>
              (game.currentState === null ? 'unplayed' : STATE_TO_STATUS_KEY[game.currentState]) ===
              key,
          ).length,
        }))
      : YEAR_ENTRIES.map(({ type, label }) => {
          const statusKey = STATE_TO_STATUS_KEY[type];
          return {
            key: type,
            label,
            color: STATUS_META[statusKey].color,
            Icon: STATUS_META[statusKey].Icon,
            count: props.stateEvents.filter(
              (event) => event.type === type && event.occurredAt.getFullYear() === props.year,
            ).length,
          };
        });

  const maxCount = Math.max(1, ...bars.map((bar) => bar.count));

  return (
    <StatCard
      title={props.mode === 'all-time' ? 'Status Breakdown' : 'Status Changes'}
      titleClassName="mb-4.5"
    >
      <div className="flex flex-col gap-4">
        {bars.map((bar) => (
          <div key={bar.key}>
            <div className="mb-1.75 flex items-center gap-2.25">
              <bar.Icon size={14} color={bar.color} />
              <span className="text-[13.5px] font-semibold" style={{ color: bar.color }}>
                {bar.label}
              </span>
              <span className="ml-auto text-[14px] font-bold tabular-nums text-foreground">
                {bar.count}
              </span>
            </div>
            <div className="h-1.75 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full opacity-80"
                style={{ width: `${(bar.count / maxCount) * 100}%`, background: bar.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
