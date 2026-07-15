import { Package, Star } from 'lucide-react';
import type { GameDetail, IterationDetail } from '../../../../../shared/types';
import { useUpdateIteration } from '../../../hooks/iterations';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatHours, formatMoney } from '../../../lib/format';
import { getGameStatusMeta } from '../../../lib/gameStatus';
import { Dropdown } from '../add-game/Dropdown';

type PlaythroughPanelProps = {
  game: GameDetail;
  // Controlado desde GameDetail (no estado propio): HowLongToBeatCard
  // necesita saber cuál es el playthrough elegido para mover su marcador,
  // así que la selección vive un nivel más arriba, no aquí dentro.
  selectedIteration: IterationDetail;
  onSelectIteration: (id: number) => void;
};

const FieldRow = ({
  label,
  value,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}): React.JSX.Element => (
  <div
    className={`flex items-center justify-between py-2.25 ${last ? '' : 'border-b border-white/5'}`}
  >
    <span className="text-[12.5px] text-muted-foreground">{label}</span>
    <span className="text-[13px] font-semibold text-foreground">{value}</span>
  </div>
);

// Mismo lenguaje visual que el badge PLAYING del HeroBanner (punto verde
// con pulso), en miniatura para caber en una fila del selector.
const OngoingBadge = (): React.JSX.Element => (
  <span
    className="ml-1.5 inline-flex items-center gap-1 rounded-full px-1.75 py-0.5 align-middle"
    style={{ background: 'rgba(47,220,126,.14)', border: '1px solid rgba(47,220,126,.4)' }}
  >
    <span
      className="h-1.25 w-1.25 rounded-full bg-primary"
      style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
    />
    <span className="text-[9.5px] font-extrabold tracking-[.08em] text-primary">ONGOING</span>
  </span>
);

const RatingRow = ({
  rating,
  onRate,
}: {
  rating: 1 | 2 | 3 | 4 | 5 | null;
  onRate: (value: number) => void;
}): React.JSX.Element => (
  <div
    className="mb-2.5 flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5"
    style={{ background: 'rgba(227,178,74,.06)', border: '1px solid rgba(227,178,74,.18)' }}
  >
    <div>
      <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">MY RATING</div>
      <div
        className="mt-0.5 text-[11.5px] font-semibold text-amber-400"
        style={{ color: '#e3b24a' }}
      >
        {rating ? `${rating}/5` : 'Not rated'}
      </div>
    </div>
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => {
        const on = rating !== null && value <= rating;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onRate(value === rating ? 0 : value)}
            className="flex-none cursor-pointer"
          >
            <Star size={19} color="#e3b24a" fill={on ? '#e3b24a' : 'none'} strokeWidth={1.6} />
          </button>
        );
      })}
    </div>
  </div>
);

// SPEC 10.7 / prototipo — card "Playthrough" del sidebar: selector + badge
// de extra content + valoración (editable) + campos de solo lectura.
export const PlaythroughPanel = ({
  game,
  selectedIteration,
  onSelectIteration,
}: PlaythroughPanelProps): React.JSX.Element => {
  const updateIteration = useUpdateIteration();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const iteration = selectedIteration;
  // El selector muestra las horas de cada playthrough para poder comparar
  // sin tener que ir cambiando de uno en uno — un badge ONGOING si es el
  // activo (todavía sin fecha de fin, las horas seguirán subiendo).
  const labelsById = new Map<string, React.ReactNode>(
    game.iterations.map((it) => [
      String(it.id),
      <span key={it.id} className="inline-flex items-center">
        <span>
          {it.label} — {formatHours(it.hours)}
        </span>
        {it.currentState === 'started' && <OngoingBadge />}
      </span>,
    ]),
  );
  const status = getGameStatusMeta(iteration.currentState);
  const startSession = iteration.sessions.find(
    (session) => session.id === iteration.startSessionId,
  );
  const endSession = iteration.sessions.find((session) => session.id === iteration.endSessionId);

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="mb-3 text-[13.5px] font-bold text-foreground">Playthrough</div>

      {game.iterations.length > 1 && (
        <Dropdown
          value={String(iteration.id)}
          options={game.iterations.map((it) => String(it.id))}
          onChange={(id) => onSelectIteration(Number(id))}
          renderOption={(id) => labelsById.get(id)}
        />
      )}

      <div className="mt-3.5">
        {iteration.extraContent && (
          <span
            className="mb-2.5 inline-flex items-center gap-1.5 rounded-md px-2.25 py-1 text-[10.5px] font-extrabold tracking-[.05em]"
            style={{
              color: '#85a3d6',
              border: '1px solid rgba(133,163,214,.38)',
              background: 'rgba(133,163,214,.1)',
            }}
          >
            <Package size={11} />
            EXTRA CONTENT ONLY
          </span>
        )}

        <RatingRow
          rating={iteration.rating}
          onRate={(value) =>
            updateIteration.mutate({ id: iteration.id, patch: { rating: value || null } })
          }
        />

        <FieldRow
          label="Started"
          value={
            iteration.startedAt
              ? formatByPrecision(
                  iteration.startedAt,
                  startSession?.datePrecision ?? 'day',
                  timeFormat,
                )
              : '—'
          }
        />
        <FieldRow
          label="Finished / left"
          value={
            iteration.endedAt
              ? formatByPrecision(iteration.endedAt, endSession?.datePrecision ?? 'day', timeFormat)
              : '—'
          }
        />
        <FieldRow
          label="Status"
          value={
            <span className="flex items-center gap-1.25" style={{ color: status.color }}>
              <status.Icon
                size={13}
                color={status.color}
                fill={status.filled ? status.color : 'none'}
              />
              {status.label}
            </span>
          }
        />
        <FieldRow label="Platform" value={iteration.playedPlatform} />
        <FieldRow label="Format" value={iteration.format === 'physical' ? 'Physical' : 'Digital'} />
        <FieldRow label="Origin" value={<span className="capitalize">{iteration.origin}</span>} />
        <FieldRow label="Hours" value={formatHours(iteration.hours)} />
        <FieldRow
          label="Spent"
          value={
            <span style={{ color: '#2fdc7e' }}>
              {iteration.spend > 0 ? formatMoney(iteration.spend) : 'Free'}
            </span>
          }
          last
        />
      </div>
    </div>
  );
};
