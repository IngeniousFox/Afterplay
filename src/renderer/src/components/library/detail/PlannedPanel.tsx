import { Bookmark } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useTimeFormat } from '../../../hooks/settings';
import { AMBER } from '../../../lib/colors';
import { daysBetween, humanizeSpan } from '../../../lib/dateMath';
import { formatByPrecision, formatHours, formatMoney } from '../../../lib/format';
import { STATUS_META } from '../../../lib/gameStatus';

const PLAN_COLOR = STATUS_META.plan.color;

type PlannedPanelProps = {
  game: GameDetail;
};

const Tile = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div
    className="rounded-[11px] border px-3 py-2.5"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="text-[10px] font-bold tracking-[.11em]" style={{ color: `${color}b3` }}>
      {label}
    </div>
    <div className="mt-1 text-[17px] font-extrabold tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);

// El equivalente del Status card para un juego que todavía no se juega: un
// planeado no tiene estado ni playthrough, pero sí tiene lo que sí es suyo —
// cuánto lleva esperando, lo que te va a costar en horas según HLTB y lo que
// ya te has dejado en él (pre-compra, edición especial). Sin esto la ficha
// del Plan era la misma que la de biblioteca con huecos donde faltan cosas.
export const PlannedPanel = ({ game }: PlannedPanelProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  // La fecha en la que entró al plan: su evento 'plan_to_play' si existe (es
  // el que la ficha del Plan enseña en el historial), y si no la de alta en
  // la app — que para un juego planeado son la misma al milisegundo.
  const planEvent = game.stateHistory.find((event) => event.type === 'plan_to_play');
  const plannedSince = planEvent?.occurredAt ?? game.addedAt;
  const waiting = humanizeSpan(daysBetween(plannedSince, new Date()));

  return (
    <div
      className="rounded-[14px] border px-5 py-4.5"
      style={{
        borderColor: `${PLAN_COLOR}2e`,
        background: `linear-gradient(135deg, ${PLAN_COLOR}1a, ${PLAN_COLOR}08 60%, transparent)`,
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px]"
          style={{ background: `${PLAN_COLOR}24`, border: `1px solid ${PLAN_COLOR}3d` }}
        >
          <Bookmark size={19} color={PLAN_COLOR} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold" style={{ color: PLAN_COLOR }}>
            On your plan
          </div>
          <div className="mt-0.25 truncate text-[12px] text-muted-foreground">
            Since {formatByPrecision(plannedSince, 'day', timeFormat)}
          </div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <Tile color={PLAN_COLOR} label="WAITING" value={waiting} />
        {/* Solo si HLTB trae el dato: un "0h para terminarlo" es mentira, no
            es un cero de verdad (mismo criterio que HowLongToBeatCard). */}
        {game.hltbMain ? (
          <Tile color="#2bb6a6" label="TO BEAT" value={formatHours(game.hltbMain)} />
        ) : null}
        {game.totalSpend > 0 && (
          <Tile color={AMBER} label="ALREADY SPENT" value={formatMoney(game.totalSpend)} />
        )}
      </div>
    </div>
  );
};
