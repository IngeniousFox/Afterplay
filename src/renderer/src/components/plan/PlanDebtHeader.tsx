import { CalendarClock, Hourglass, Pin, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GRAY, VIOLET } from '../../lib/colors';
import { pluralize } from '../../lib/format';
import { STATUS_META } from '../../lib/gameStatus';
import type { PlanDebt } from '../../lib/plan';

const PLAN_COLOR = STATUS_META.plan.color;

type PlanDebtHeaderProps = {
  debt: PlanDebt;
  upNextCount: number;
  queueCount: number;
  horizonCount: number;
};

// La CABECERA HONESTA (PLAN-TO-PLAY.md §2.1): "1.400 horas por delante, en
// 262 juegos".
//
// El número ya existía —la card de Backlog debt de Stats lo suma desde hace
// tiempo—, pero vivía en otra pantalla, mezclado con lo que tienes sin tocar
// en la biblioteca. Ponérselo delante al Plan es decirle la verdad a la
// sección: esto no es una lista de deseos, es una deuda de tiempo, y saber
// cuánto mide es lo que hace que "uno más no pasa nada" deje de ser gratis.
//
// El violeta es el mismo con el que Stats pinta la deuda cuando crece — no
// es un color decorativo elegido aquí, es el que la app ya usa para esto.
export const PlanDebtHeader = ({
  debt,
  upNextCount,
  queueCount,
  horizonCount,
}: PlanDebtHeaderProps): React.JSX.Element => (
  <div
    className="relative overflow-hidden rounded-[16px] border px-5.5 py-4.5"
    style={{
      borderColor: `${VIOLET}2b`,
      background: `linear-gradient(135deg, ${VIOLET}18, ${VIOLET}07 55%, transparent)`,
    }}
  >
    <div className="flex flex-col gap-4.5 sm:flex-row sm:items-center sm:gap-7">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div
          className="flex h-12 w-12 flex-none items-center justify-center rounded-[13px]"
          style={{ background: `${VIOLET}24`, border: `1px solid ${VIOLET}3d` }}
        >
          <Hourglass size={21} color={VIOLET} />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[32px] leading-none font-extrabold tabular-nums"
              style={{ color: VIOLET }}
            >
              {Math.round(debt.totalHours).toLocaleString()}
            </span>
            <span className="text-[14px] font-semibold text-muted-foreground">hours ahead</span>
          </div>
          <div className="mt-1.25 text-[12.5px] text-muted-foreground">
            across {pluralize(debt.totalGames, 'game')} on your plan
            {/* Los juegos sin estimación se cuentan aparte y se dicen en
                pequeño — rellenarlos con la media daría una cifra que parece
                exacta y no lo es (la misma regla que Backlog debt). */}
            {debt.withoutEstimate > 0 && (
              <span className="text-muted-foreground/60">
                {' · '}
                {debt.withoutEstimate} without an estimate
              </span>
            )}
          </div>
        </div>
      </div>

      {/* El reparto: cuánto de esta lista es compromiso, cuánto es "algún
          día" y cuánto ni siquiera se puede jugar todavía. Tres números que
          responden solos a "¿por dónde empiezo?". */}
      <div className="flex flex-none gap-2">
        <DebtTile Icon={Pin} color={PLAN_COLOR} label="UP NEXT" value={upNextCount} />
        <DebtTile Icon={Play} color={GRAY} label="READY" value={queueCount} />
        {horizonCount > 0 && (
          <DebtTile Icon={CalendarClock} color={VIOLET} label="NOT OUT" value={horizonCount} />
        )}
      </div>
    </div>
  </div>
);

const DebtTile = ({
  Icon,
  color,
  label,
  value,
}: {
  Icon: LucideIcon;
  color: string;
  label: string;
  value: number;
}): React.JSX.Element => (
  <div
    className="min-w-19 rounded-[11px] border px-3 py-2"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="flex items-center gap-1.25">
      <Icon size={10} style={{ color: `${color}c4` }} />
      <span className="text-[9.5px] font-bold tracking-[.11em]" style={{ color: `${color}c4` }}>
        {label}
      </span>
    </div>
    <div className="mt-0.75 text-[18px] leading-none font-extrabold tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);
