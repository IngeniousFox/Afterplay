import { cn } from '../../lib/utils';
import type { PlanHistory, StateEvent } from '../../../../shared/types';
import type { CSSProperties } from 'react';
import { useTimeFormat } from '../../hooks/settings';
import { calendarDaysBetween, daysBetween, humanizeSpan } from '../../lib/dateMath';
import { formatByPrecision } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { enteredViaPlan, planMilestones } from '../../lib/planMilestones';
import { StatusIcon } from '../StatusIcon';
import { StatCard } from './StatCard';
import { compareByCreation } from '../../../../shared/entityIds';

type JourneySession = { startedAt: Date; endedAt: Date | null };

type GameJourneyCardProps = {
  addedAt: Date;
  // El paso por el Plan (R-06): sus dos hitos van en la tira como nodos.
  planHistory: PlanHistory | null;
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
  planHistory,
  stateHistory,
  sessions,
}: GameJourneyCardProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  // Cronológico ascendente. Los eventos sin fecha ('unknown', el papeleo del
  // alta o de la promoción sin fecha, R-07) no son un paso del viaje: no
  // consta cuándo fueron y su fecha es solo un ancla.
  const events = stateHistory
    .filter((event) => event.datePrecision !== 'unknown')
    .sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || compareByCreation(a.id, b.id),
    );

  // "Added" sobra si el juego entró por el Plan: el nodo "Added to Plan" lo
  // cuenta el mismo día (mismo criterio que el History de la ficha).
  const planMeta = getGameStatusMeta('plan_to_play');
  const derivedNodes = [
    ...(enteredViaPlan(addedAt, planHistory)
      ? []
      : [{ key: 'added', meta: getGameStatusMeta(null), label: 'Added', date: addedAt }]),
    ...planMilestones(planHistory).map((milestone) => ({
      key: milestone.key,
      meta: planMeta,
      label: milestone.label,
      date: milestone.date,
    })),
  ];
  const nodes = [
    ...derivedNodes.map((node) => ({ ...node, precision: 'day' as const })),
    ...events.map((event) => ({
      key: `event-${event.id}`,
      meta: getGameStatusMeta(event.type),
      label: getGameStatusMeta(event.type).label,
      date: event.occurredAt,
      precision: event.datePrecision,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

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
    // Días de CALENDARIO, no horas transcurridas: con la resta cruda, una
    // sesión cerrada ayer a las 20:00 daba 0,58 a las 10:00 de hoy y el chip
    // anunciaba "Played today" un juego que hoy no habías tocado (y un día y
    // pico se redondeaba a "2 days ago"). Es la cicatriz que GameCard y el
    // modo TV ya tenían curada; esta card se había quedado con la vieja.
    const ago = calendarDaysBetween(lastPlayedAt, new Date());
    chips.push(ago < 1 ? 'Played today' : `Last played ${humanizeSpan(ago)} ago`);
  }

  const latestNode = nodes[nodes.length - 1];

  return (
    <StatCard
      className={cn(
        'afterplay-game-journey',
        'relative overflow-hidden',
        '[background:radial-gradient(circle_at_0%_50%,rgba(255,179,71,0.055),transparent_37%),var(--card)]',
        'before:absolute before:top-[0] before:bottom-[0] before:left-[0] before:w-[2px]',
        'before:[background:linear-gradient(180deg,transparent,var(--primary),transparent)]',
        "before:content-[''] before:opacity-[0.6]",
        '[&_.afterplay-game-card-heading>strong]:border',
        '[&_.afterplay-game-card-heading>strong]:border-[color-mix(in_srgb,currentColor_25%,transparent)]',
        '[&_.afterplay-game-card-heading>strong]:bg-bone/[0.025]',
      )}
    >
      <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[16px] font-semibold text-bone">Your journey</span>
          <small className="text-micro text-bone/[0.34]">
            Every turn this game has taken with you
          </small>
        </div>
        <strong
          className="rounded-[99px] px-2 py-1.25 text-micro font-semibold whitespace-nowrap"
          style={{ color: latestNode.meta.color }}
        >
          {nodes.length} milestones
        </strong>
      </div>

      <div className="afterplay-game-journey-track [scrollbar-width:thin] flex items-start overflow-x-auto px-0.5 pt-2.75 pb-1.25">
        {nodes.map((node, index) => (
          <div
            key={node.key}
            className={`afterplay-game-journey-step [--journey-color:var(--primary)] group/journey-step flex flex-none items-start ${
              index === nodes.length - 1 ? 'is-current' : ''
            }`}
            style={{ '--journey-color': node.meta.color } as CSSProperties}
          >
            {index > 0 && (
              <div
                className={cn(
                  'afterplay-game-journey-connector',
                  'relative h-9.5 w-11.75 flex-none',
                  'before:absolute before:top-[18px] before:right-[4px] before:left-[4px] before:h-[1px]',
                  'before:[background:linear-gradient(90deg,rgba(233,228,216,0.09),var(--journey-color))]',
                  "before:content-['']",
                  '[&_i]:bg-(--journey-color) [&_i]:shadow-[0_0_10px_var(--journey-color)]',
                )}
                aria-hidden="true"
              >
                <i className="absolute top-4 right-0.5 size-1.25 rounded-[50%] opacity-[0.65]" />
              </div>
            )}
            <div
              className={cn(
                'afterplay-game-journey-node',
                'flex w-max min-w-19.5 flex-col items-center',
                'group-hover/journey-step:transform-[translateY(-3px)]',
                '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1)]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
            >
              <span
                className={cn(
                  'afterplay-game-journey-orbit',
                  'relative flex size-9.5 items-center justify-center rounded-[50%] text-(--journey-color)',
                  'border border-[color-mix(in_srgb,var(--journey-color)_42%,transparent)]',
                  'bg-[color-mix(in_srgb,var(--journey-color)_13%,rgba(12,14,13,0.9))]',
                  'shadow-[0_0_0_4px_rgba(233,228,216,0.018)]',
                  'group-[&.is-current]/journey-step:after:absolute group-[&.is-current]/journey-step:after:inset-[-5px]',
                  'group-[&.is-current]/journey-step:after:border',
                  'group-[&.is-current]/journey-step:after:border-(--journey-color)',
                  'group-[&.is-current]/journey-step:after:rounded-[50%]',
                  "group-[&.is-current]/journey-step:after:content-['']",
                  'group-[&.is-current]/journey-step:after:opacity-[0.28]',
                  'group-[&.is-current]/journey-step:after:animate-[afterplay-game-journey-pulse_2.4s_ease-in-out_infinite]',
                  'group-hover/journey-step:shadow-[0_0_0_4px_color-mix(in_srgb,var(--journey-color)_8%,transparent),0_0_20px_color-mix(in_srgb,var(--journey-color)_18%,transparent)]',
                  'group-hover/journey-step:transform-[scale(1.08)]',
                  '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1),box-shadow_260ms_ease]',
                  'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:after:animate-none',
                  'motion-reduce:after:transition-none',
                )}
              >
                <StatusIcon meta={node.meta} size={14} />
              </span>
              <span className="afterplay-game-journey-label mt-1.75 text-micro font-semibold whitespace-nowrap text-(--journey-color)">
                {node.label}
              </span>
              <span className="afterplay-game-journey-date mt-0.5 text-micro whitespace-nowrap text-bone/[0.35]">
                {formatByPrecision(node.date, node.precision, timeFormat)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {chips.length > 0 && (
        <div
          className={cn(
            'afterplay-game-journey-insights',
            'mt-4.5 grid grid-cols-3 gap-2 pt-3.5',
            'border-t border-t-line',
            '[&>span]:border [&>span]:border-line [&>span]:bg-bone/[0.022]',
            '[&>span]:[transition:border-color_180ms_ease,background-color_180ms_ease,transform_220ms_cubic-bezier(0.22,1,0.36,1)]',
            '[&>span:hover]:border-[rgba(255,179,71,0.18)] [&>span:hover]:bg-[rgba(255,179,71,0.04)]',
            '[&>span:hover]:transform-[translateY(-2px)]',
            '[@media(width<=760px)]:grid-cols-[minmax(0,1fr)]',
            'motion-reduce:[&>span]:animate-none motion-reduce:[&>span]:transition-none',
          )}
        >
          {chips.map((chip, index) => (
            <span
              className="flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-micro font-semibold text-dust"
              key={chip}
            >
              <i className="text-micro font-semibold text-phosphor not-italic">
                {String(index + 1).padStart(2, '0')}
              </i>
              {chip}
            </span>
          ))}
        </div>
      )}
    </StatCard>
  );
};
