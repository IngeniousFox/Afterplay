import {
  Disc3,
  Download,
  Gamepad2,
  Infinity as InfinityIcon,
  Package,
  Star,
  Tag,
} from 'lucide-react';
import { useState } from 'react';
import type { GameDetail, IterationDetail } from '../../api';
import { cn } from '../../lib/cn';
import {
  formatByPrecision,
  formatHours,
  formatMoney,
  humanizeSpanByPrecision,
} from '../../lib/format';
import { statusOf } from '../../lib/status';
import { statusTextClass } from '../../lib/styles';
import { Led, LiveDot } from '../Figure';
import { DetailCard, FigureCell, InfoChip, SectionLabel } from './primitives';

// La línea de viaje: inicio ──── cuánto duró ──── desenlace. Un playthrough es
// un tramo de tiempo, y verlo como tramo dice cosas que dos fechas sueltas no
// dicen (que te duró tres semanas, o que llevas dos meses enganchado).
const JourneyStrip = ({ iteration }: { iteration: IterationDetail }): React.JSX.Element | null => {
  // "Ahora" se congela al montar, no se lee en cada render: el ESLint de la
  // casa lo prohíbe (`react-hooks/purity`) y un playthrough abierto cambiaba
  // su duración en cada repintado incidental sin que cambiara ningún dato.
  const [now] = useState(() => Date.now());

  if (iteration.startedAt === null) return null;

  const isOngoing = iteration.endedAt === null;
  const status = statusOf(iteration.currentState);

  // La precisión de cada fecha derivada: un inicio medido por sesión real es
  // un instante exacto; uno tecleado a mano lleva la precisión de su evento.
  const startedPrecision = iteration.startedBySession
    ? ('datetime' as const)
    : (iteration.startEvent?.datePrecision ?? 'day');
  const endedPrecision = iteration.endEvent?.datePrecision ?? 'day';

  // Uno en marcha se mide contra AHORA ("llevas 3 semanas"), uno cerrado
  // contra su fecha de fin.
  const span = humanizeSpanByPrecision(
    iteration.startedAt,
    iteration.endedAt ?? now,
    startedPrecision,
    iteration.endedAt !== null ? endedPrecision : 'datetime',
  );

  return (
    <div className="mt-3">
      <div className="flex items-start justify-between gap-3 text-small">
        <div className="min-w-0">
          <div className="text-micro text-dust">Started</div>
          <div className="font-semibold text-bone">
            {formatByPrecision(iteration.startedAt, startedPrecision)}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-micro text-dust">{isOngoing ? 'Ongoing' : status.label}</div>
          <div className="font-semibold text-bone">
            {iteration.endedAt !== null
              ? formatByPrecision(iteration.endedAt, endedPrecision)
              : 'Still going'}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2" aria-hidden="true">
        <span className="size-1.5 shrink-0 rounded-full bg-dust" />
        <span className="h-px flex-1 bg-line-strong" />
        <span className="shrink-0 text-micro text-dust">
          {/* "Same year so far" no se lee bien — con un tramo que no es una
              duración, el sufijo sobra. */}
          {isOngoing && !span.startsWith('Same') ? `${span} so far` : span}
        </span>
        <span className="h-px flex-1 bg-line-strong" />
        {isOngoing ? <LiveDot /> : <Led state={iteration.currentState} />}
      </div>
    </div>
  );
};

// Las estrellas son de SOLO LECTURA aquí: unas estrellas que parecen pulsables
// pero no guardan nada son peores que unas que se ven claramente como un dato.
const RatingRow = ({ rating }: { rating: 1 | 2 | 3 | 4 | 5 | null }): React.JSX.Element | null => {
  if (rating === null) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-small text-dust">My rating</span>
      <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Star
            key={value}
            size={17}
            strokeWidth={1.7}
            aria-hidden="true"
            className={cn('text-phosphor', value <= rating ? 'fill-phosphor' : 'fill-none')}
          />
        ))}
      </div>
    </div>
  );
};

// Sustituye al panel de Playthrough cuando el juego es endless: no hay
// playthroughs que completar, solo sesiones sueltas.
export const EndlessBadge = (): React.JSX.Element => (
  <DetailCard className="flex items-center gap-3.5">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-st-resting/15 text-st-resting">
      <InfinityIcon size={20} aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <div className="text-body font-semibold text-st-resting">Endless game</div>
      <div className="text-small text-dust">No playthroughs to complete, tracked by sessions.</div>
    </div>
  </DetailCard>
);

type Props = {
  game: GameDetail;
  selected: IterationDetail;
  onSelect: (id: string) => void;
};

// Panel "Playthrough": el estado del elegido, su tramo de tiempo, sus cifras
// y la ficha técnica en píldoras.
//
// El selector son píldoras y no un desplegable: comparar recorridos es justo
// para lo que existe, y con un dropdown hay que abrirlo y cerrarlo para ver el
// siguiente. En móvil la fila se desliza en horizontal.
export const PlaythroughPanel = ({ game, selected, onSelect }: Props): React.JSX.Element => {
  const status = statusOf(selected.currentState);
  const hasSeveral = game.iterations.length > 1;
  const number = game.iterations.findIndex((iteration) => iteration.id === selected.id) + 1;

  return (
    <section>
      <SectionLabel className="mb-2">Playthrough</SectionLabel>
      <DetailCard>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-body font-semibold">
            <Led state={selected.currentState} />
            <span className={statusTextClass(selected.currentState)}>{status.label}</span>
          </span>
          <span className="text-small text-dust">#{number}</span>
        </div>

        {hasSeveral && (
          <div className="-mx-4 mt-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div role="group" aria-label="Playthroughs" className="flex w-max gap-2">
              {game.iterations.map((iteration, index) => {
                const active = iteration.id === selected.id;
                return (
                  <button
                    key={iteration.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(iteration.id)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-sm border px-3 text-small font-medium',
                      'transition-[transform,scale,background-color,border-color] duration-150 active:scale-[.96] motion-reduce:active:scale-100',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
                      active
                        ? 'border-phosphor bg-phosphor-tint text-bone'
                        : 'border-line-strong bg-raised text-dust',
                    )}
                  >
                    {iteration.currentState === 'started' && <LiveDot />}
                    <span>#{index + 1}</span>
                    <span className="text-dust">{formatHours(iteration.hours)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <JourneyStrip iteration={selected} />

        <div className="mt-4 flex border-t border-line pt-3">
          <FigureCell value={formatHours(selected.hours)} label="Played" accent />
          <FigureCell value={String(selected.sessions.length)} label="Sessions" />
          <FigureCell
            value={selected.spend > 0 ? formatMoney(selected.spend) : 'Free'}
            label="Spent"
          />
        </div>

        <RatingRow rating={selected.rating} />

        {/* Ficha técnica: etiquetas, no medidas — una fila de píldoras. */}
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          <InfoChip Icon={Gamepad2}>{selected.playedPlatform}</InfoChip>
          {selected.format && (
            <InfoChip Icon={selected.format === 'physical' ? Disc3 : Download}>
              {selected.format === 'physical' ? 'Physical' : 'Digital'}
            </InfoChip>
          )}
          <InfoChip Icon={Tag}>
            <span className="capitalize">{selected.origin}</span>
          </InfoChip>
          {selected.extraContent && (
            <InfoChip Icon={Package} tone="tube">
              Extra content only
            </InfoChip>
          )}
        </div>
      </DetailCard>
    </section>
  );
};
