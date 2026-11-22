import { CalendarClock, Pin, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pluralize } from '../../lib/format';
import { GlowText, Ticker } from '../fx';
import type { PlanDebt } from '../../../../shared/planShelves';

type PlanDebtHeaderProps = {
  debt: PlanDebt;
  upNextCount: number;
  queueCount: number;
  horizonCount: number;
};

// La CABECERA HONESTA (PLAN-TO-PLAY.md §2.1): "1.400 horas por delante, en
// 262 juegos". Ponérselo delante al Plan es decirle la verdad a la sección:
// esto no es una lista de deseos, es una deuda de tiempo, y saber cuánto mide
// es lo que hace que "uno más no pasa nada" deje de ser gratis.
//
// En Fósforo es una tira de cifras sin cajas, como la de la semana en Home:
// la deuda en numerales grandes y, a la derecha, el reparto en tres cifras.
// Las cifras entran contando como un marcador (Ticker) y, al fijar o soltar un
// juego, cuentan desde lo que se veía; la deuda lleva el bloom del fósforo.
const thousands = (value: number): string => Math.round(value).toLocaleString('en-US');

export const PlanDebtHeader = ({
  debt,
  upNextCount,
  queueCount,
  horizonCount,
}: PlanDebtHeaderProps): React.JSX.Element => (
  <section
    aria-label="Backlog debt"
    className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 rounded-md border border-line bg-panel px-6 py-5"
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <GlowText
          tone="bone"
          className="font-display text-[56px] leading-[52px] font-bold text-bone tabular-nums"
        >
          <Ticker value={debt.totalHours} format={thousands} duration={900} from="previous" />
        </GlowText>
        <span className="text-lead font-semibold text-bone">hours ahead</span>
      </div>
      <p className="mt-2 text-small text-dust">
        across {pluralize(debt.totalGames, 'game')} on your plan
        {/* Los juegos sin estimación se cuentan aparte — rellenarlos con la
            media daría una cifra que parece exacta y no lo es (la misma regla
            que Backlog debt). */}
        {debt.withoutEstimate > 0 && ` · ${debt.withoutEstimate} without an estimate`}
      </p>
    </div>

    {/* El reparto: cuánto de esta lista es compromiso, cuánto es "algún día"
        y cuánto ni siquiera se puede jugar todavía. */}
    <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <DebtFigure
        Icon={Pin}
        label="Up next"
        value={upNextCount}
        className="text-phosphor"
        iconClassName="text-phosphor"
      />
      <DebtFigure
        Icon={Play}
        label="Ready"
        value={queueCount}
        className="text-bone"
        iconClassName="text-dust"
      />
      {horizonCount > 0 && (
        <DebtFigure
          Icon={CalendarClock}
          label="Not out"
          value={horizonCount}
          className="text-bone"
          iconClassName="text-st-resting"
        />
      )}
    </dl>
  </section>
);

const DebtFigure = ({
  Icon,
  label,
  value,
  className,
  iconClassName,
}: {
  Icon: LucideIcon;
  label: string;
  value: number;
  className: string;
  iconClassName: string;
}): React.JSX.Element => (
  <div className="flex flex-col-reverse">
    <dt className="mt-1.5 flex items-center gap-1.5 text-small text-dust">
      <Icon aria-hidden size={13} className={cn('flex-none', iconClassName)} />
      {label}
    </dt>
    <dd className={cn('font-display text-[34px] leading-none font-bold tabular-nums', className)}>
      <Ticker value={value} from="previous" />
    </dd>
  </div>
);
