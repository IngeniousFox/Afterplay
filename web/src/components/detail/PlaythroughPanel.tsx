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
import {
  formatByPrecision,
  formatHours,
  formatMoney,
  humanizeSpanByPrecision,
} from '../../lib/format';
import { AMBER, GREEN, statusOf, VIOLET } from '../../lib/status';
import { CardTitle, DetailCard, InfoChip, StatTile } from './primitives';

// La tira de viaje: inicio ──── cuánto duró ──── desenlace. Un playthrough es
// un tramo de tiempo, y verlo como tramo dice cosas que dos fechas sueltas en
// filas separadas no dicen (que te duró tres semanas, o que llevas dos meses
// enganchado).
const JourneyStrip = ({ iteration }: { iteration: IterationDetail }): React.JSX.Element | null => {
  // "Ahora" se congela al montar, no se lee en cada render.
  //
  // Dos motivos: el ESLint de la casa lo prohíbe (`react-hooks/purity` —
  // Date.now es impura), y es un fallo real — un playthrough abierto
  // recalculaba su duración en cada repintado incidental (un refetch al volver
  // a la pestaña, un cambio de estado del padre), así que el tramo cambiaba
  // sin que hubiera cambiado ningún dato. Con un valor por montaje, lo que se
  // ve es estable mientras la pantalla lo esté.
  const [now] = useState(() => Date.now());

  if (iteration.startedAt === null) return null;

  const status = statusOf(iteration.currentState);
  const isOngoing = iteration.endedAt === null;

  // La precisión de cada fecha derivada: un inicio medido por sesión real es
  // un instante exacto; uno tecleado a mano lleva la precisión de su evento.
  const startedPrecision = iteration.startedBySession
    ? ('datetime' as const)
    : (iteration.startEvent?.datePrecision ?? 'day');
  const endedPrecision = iteration.endEvent?.datePrecision ?? 'day';

  // Uno en marcha se mide contra AHORA ("llevas 3 semanas"), uno cerrado
  // contra su fecha de fin. Con fechas de solo año/mes no se puede hablar de
  // días — "ahora" sí es un instante exacto, así que en los abiertos manda la
  // precisión del inicio.
  const span = humanizeSpanByPrecision(
    iteration.startedAt,
    iteration.endedAt ?? now,
    startedPrecision,
    iteration.endedAt !== null ? endedPrecision : 'datetime',
  );

  return (
    <div className="rounded-[12px] border border-border bg-white/[0.02] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            STARTED
          </div>
          <div className="mt-0.75 truncate text-[12px] font-semibold text-foreground">
            {formatByPrecision(iteration.startedAt, startedPrecision)}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div
            className="text-[9.5px] font-bold tracking-[.12em]"
            style={{ color: isOngoing ? GREEN : `${status.color}cc` }}
          >
            {isOngoing ? 'ONGOING' : status.label.toUpperCase()}
          </div>
          <div className="mt-0.75 truncate text-[12px] font-semibold text-foreground">
            {iteration.endedAt !== null
              ? formatByPrecision(iteration.endedAt, endedPrecision)
              : 'Still going'}
          </div>
        </div>
      </div>

      <div className="mt-2.75 flex items-center gap-2">
        <span className="h-1.75 w-1.75 flex-none rounded-full bg-muted-foreground" />
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="flex-none text-[10.5px] font-semibold whitespace-nowrap text-muted-foreground">
          {/* "Same year so far" no se lee bien — con un tramo que no es una
              duración, el sufijo sobra. */}
          {isOngoing && !span.startsWith('Same') ? `${span} so far` : span}
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{
            background: isOngoing ? GREEN : status.color,
            ...(isOngoing ? { animation: 'afterplay-pulse-dot 1.4s infinite' } : {}),
          }}
        />
      </div>
    </div>
  );
};

// Las estrellas son de SOLO LECTURA aquí. La web es de solo lectura entera
// (REMOTO.md §1.1), y unas estrellas que parecen pulsables pero no guardan
// nada son peores que unas que se ven claramente como un dato.
const RatingRow = ({ rating }: { rating: 1 | 2 | 3 | 4 | 5 | null }): React.JSX.Element | null => {
  if (rating === null) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-bold tracking-[.12em] text-muted-foreground">
        MY RATING
      </span>
      <div className="flex items-center gap-0.75">
        {[1, 2, 3, 4, 5].map((value) => (
          <Star
            key={value}
            size={16}
            color={AMBER}
            fill={value <= rating ? AMBER : 'none'}
            strokeWidth={1.7}
          />
        ))}
      </div>
    </div>
  );
};

// Sustituye al panel de Playthrough cuando el juego es endless: no hay
// playthroughs que completar, solo sesiones sueltas.
export const EndlessBadge = (): React.JSX.Element => (
  <div
    className="flex items-center gap-3.5 rounded-[14px] border px-4 py-4"
    style={{
      borderColor: `${VIOLET}2e`,
      background: `linear-gradient(135deg, ${VIOLET}1a, ${VIOLET}08 60%, transparent)`,
    }}
  >
    <div
      className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px]"
      style={{ background: `${VIOLET}24`, border: `1px solid ${VIOLET}3d` }}
    >
      <InfinityIcon size={20} color={VIOLET} />
    </div>
    <div className="min-w-0">
      <div className="text-[13.5px] font-bold" style={{ color: VIOLET }}>
        Endless game
      </div>
      <div className="mt-0.25 text-[11.5px] text-muted-foreground">
        No playthroughs to complete — tracked by sessions.
      </div>
    </div>
  </div>
);

type Props = {
  game: GameDetail;
  selected: IterationDetail;
  onSelect: (id: number) => void;
};

// Card "Playthrough". Tres bloques con jerarquía: el tramo de tiempo (la
// historia), las dos medidas que importan (horas y gasto) y la ficha técnica
// reducida a píldoras.
//
// El selector son píldoras y no un desplegable por el mismo motivo que en el
// escritorio: comparar recorridos es justo para lo que existe, y con un
// dropdown hay que abrirlo y cerrarlo para ver el siguiente. Aquí no se
// pagina —en móvil la fila scrollea en horizontal, que es un gesto natural—
// en vez del pager de flechas, que pediría dianas de 22px.
export const PlaythroughPanel = ({ game, selected, onSelect }: Props): React.JSX.Element => {
  const status = statusOf(selected.currentState);
  const StatusIcon = status.Icon;
  const hasSeveral = game.iterations.length > 1;

  return (
    <DetailCard>
      <CardTitle
        aside={
          <span
            className="flex flex-none items-center gap-1.25 text-[12px] font-semibold"
            style={{ color: status.color }}
          >
            <StatusIcon size={13} fill={status.filled ? status.color : 'none'} />
            {status.label}
          </span>
        }
      >
        Playthrough
      </CardTitle>

      {hasSeveral && (
        <div className="-mx-4 mt-3 overflow-x-auto px-4">
          <div className="flex w-max gap-1.5">
            {game.iterations.map((iteration, index) => {
              const active = iteration.id === selected.id;
              const ongoing = iteration.currentState === 'started';
              return (
                <button
                  key={iteration.id}
                  type="button"
                  onClick={() => onSelect(iteration.id)}
                  className="flex flex-none items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold"
                  style={
                    active
                      ? { color: GREEN, borderColor: `${GREEN}59`, background: `${GREEN}14` }
                      : {
                          color: 'var(--muted-foreground)',
                          borderColor: 'var(--border)',
                          background: 'rgba(255,255,255,.028)',
                        }
                  }
                >
                  {ongoing && (
                    <span
                      className="h-1.25 w-1.25 flex-none rounded-full"
                      style={{ background: GREEN, animation: 'afterplay-pulse-dot 1.4s infinite' }}
                    />
                  )}
                  <span>#{index + 1}</span>
                  <span className="opacity-60">{formatHours(iteration.hours)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3.5 flex flex-col gap-2.5">
        <JourneyStrip iteration={selected} />

        <div className="grid grid-cols-2 gap-2">
          <StatTile color={GREEN} label="PLAYED" value={formatHours(selected.hours)} />
          <StatTile
            color={AMBER}
            label="SPENT"
            value={selected.spend > 0 ? formatMoney(selected.spend) : 'Free'}
          />
        </div>

        <RatingRow rating={selected.rating} />

        {/* Ficha técnica: etiquetas, no medidas — una fila de píldoras en
            lugar de tres filas con su borde inferior cada una. */}
        <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
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
            <InfoChip Icon={Package} color="#85a3d6">
              Extra content only
            </InfoChip>
          )}
        </div>
      </div>
    </DetailCard>
  );
};
