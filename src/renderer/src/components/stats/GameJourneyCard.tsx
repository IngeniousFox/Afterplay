import type { StateEvent } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { daysBetween, humanizeSpan } from '../../lib/dateMath';
import { formatByPrecision } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { StatusIcon } from '../StatusIcon';
import { StatCard } from './StatCard';

type JourneySession = { startedAt: Date; endedAt: Date | null };

type GameJourneyCardProps = {
  addedAt: Date;
  stateHistory: StateEvent[];
  sessions: JourneySession[];
};

// "Your journey" — la historia del juego contigo como línea temporal
// horizontal: Added → Started → ... → Beaten, con los derivados que un
// número suelto no cuenta (cuánto esperó en el backlog, en cuánto lo
// terminaste, hace cuánto que no lo tocas). Los datos son los mismos del
// History del detalle — aquí condensados en una tira, no en lista editable.
export const GameJourneyCard = ({
  addedAt,
  stateHistory,
  sessions,
}: GameJourneyCardProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  // Cronológico ascendente, sin 'plan_to_play' (el nodo "Added" ya cuenta esa
  // entrada — mismo criterio que el History de la ficha).
  const events = [...stateHistory]
    .filter((event) => event.type !== 'plan_to_play')
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id);

  const addedMeta = getGameStatusMeta(null);
  const nodes = [
    {
      key: 'added',
      meta: addedMeta,
      label: 'Added',
      date: addedAt,
      precision: 'day' as const,
    },
    ...events.map((event) => ({
      key: `event-${event.id}`,
      meta: getGameStatusMeta(event.type),
      label: getGameStatusMeta(event.type).label,
      date: event.occurredAt,
      precision: event.datePrecision,
    })),
  ];

  // Derivados: espera en el backlog (added → primer started), tiempo hasta
  // el primer Beaten (primer started → primer completed posterior), y hace
  // cuánto fue la última sesión.
  const firstStarted = events.find((event) => event.type === 'started') ?? null;
  const firstCompleted = firstStarted
    ? (events.find(
        (event) =>
          event.type === 'completed' &&
          event.occurredAt.getTime() >= firstStarted.occurredAt.getTime(),
      ) ?? null)
    : null;

  const chips: string[] = [];
  if (firstStarted) {
    const wait = daysBetween(addedAt, firstStarted.occurredAt);
    if (wait >= 1) chips.push(`Waited ${humanizeSpan(wait)} in the backlog`);
    // Playthroughs del pasado ("I played this before"): el started es
    // anterior a la propia alta en la app — no hay espera que contar.
    else if (wait < 0) chips.push('Played before it joined Afterplay');
    else chips.push('Started the day it was added');
  }
  if (firstStarted && firstCompleted) {
    chips.push(
      `Beaten in ${humanizeSpan(daysBetween(firstStarted.occurredAt, firstCompleted.occurredAt))}`,
    );
  }
  const lastPlayedAt = sessions.reduce<Date | null>((latest, session) => {
    const end = session.endedAt ?? session.startedAt;
    return latest === null || end.getTime() > latest.getTime() ? end : latest;
  }, null);
  if (lastPlayedAt) {
    const ago = daysBetween(lastPlayedAt, new Date());
    chips.push(ago < 1 ? 'Played today' : `Last played ${humanizeSpan(ago)} ago`);
  }

  return (
    <StatCard title="Your journey" titleClassName="mb-4.5">
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {nodes.map((node, index) => (
          <div key={node.key} className="flex items-start">
            {index > 0 && (
              // Conector entre nodos — a la altura del centro del chip (h-8
              // → 16px), no del centro de la columna entera.
              <div className="mx-1.5 mt-4 h-px w-7 flex-none bg-input" />
            )}
            <div className="flex w-max min-w-16 flex-none flex-col items-center gap-1.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full border"
                style={{
                  background: `${node.meta.color}1f`,
                  borderColor: `${node.meta.color}59`,
                }}
              >
                <StatusIcon meta={node.meta} size={14} />
              </span>
              <span
                className="text-[11.5px] font-bold whitespace-nowrap"
                style={{ color: node.meta.color }}
              >
                {node.label}
              </span>
              <span className="text-[10.5px] whitespace-nowrap text-muted-foreground">
                {formatByPrecision(node.date, node.precision, timeFormat)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-input bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-semibold text-foreground"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </StatCard>
  );
};
