import { useMemo, useState } from 'react';
import { AMBER } from '../../lib/colors';
import { formatMoney } from '../../lib/format';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type ChartSpendEvent = {
  amount: number;
  occurredAt: Date;
};

type SpendByMonthChartProps = {
  spendEvents: ChartSpendEvent[];
  year: Year;
};

const BAR_AREA_PX = 150;
const LABEL_SPACE_PX = 20;

const monthKey = (year: number, month: number): number => year * 12 + month;

// El gemelo de Hours per month pero con euros — misma ventana ("All Time" =
// últimos 12 meses, un año concreto = enero a diciembre), mismas barras con
// pista de fondo y etiqueta en el pico y bajo el ratón; cambia el color (el
// ámbar del gasto, como en History) y que aquí se suman importes, no
// duraciones. Las rebajas de Steam salen como picos clavados.
export const SpendByMonthChart = ({
  spendEvents,
  year,
}: SpendByMonthChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { months, maxAmount, totalAmount, peakIndex } = useMemo(() => {
    const now = new Date();
    const firstMonth =
      year === 'all' ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(year, 0, 1);

    const amountByKey = new Map<number, number>();
    for (const event of spendEvents) {
      const key = monthKey(event.occurredAt.getFullYear(), event.occurredAt.getMonth());
      amountByKey.set(key, (amountByKey.get(key) ?? 0) + event.amount);
    }

    const months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
      return {
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        amount: amountByKey.get(monthKey(date.getFullYear(), date.getMonth())) ?? 0,
      };
    });

    const maxAmount = Math.max(0, ...months.map((month) => month.amount));
    const totalAmount = months.reduce((sum, month) => sum + month.amount, 0);
    const peakIndex = maxAmount > 0 ? months.findIndex((m) => m.amount === maxAmount) : -1;

    return { months, maxAmount, totalAmount, peakIndex };
  }, [spendEvents, year]);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Spent per month</div>
        <div className="text-[11.5px] text-muted-foreground">
          {formatMoney(totalAmount)} {year === 'all' ? 'in the last 12 months' : `in ${year}`}
        </div>
      </div>

      <div className="flex flex-1 items-end gap-1.5" style={{ minHeight: BAR_AREA_PX }}>
        {months.map((month, index) => {
          const isHovered = hoveredIndex === index;
          const showLabel = month.amount > 0 && (isHovered || index === peakIndex);
          const barPx =
            maxAmount > 0 && month.amount > 0
              ? Math.max(4, (month.amount / maxAmount) * (BAR_AREA_PX - LABEL_SPACE_PX))
              : 0;

          return (
            <div
              key={index}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="relative flex h-full flex-1 items-end justify-center"
            >
              <div
                className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-8 rounded-[6px]"
                style={{
                  height: BAR_AREA_PX - LABEL_SPACE_PX,
                  background: isHovered ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                }}
              />
              {showLabel && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-bold whitespace-nowrap tabular-nums"
                  style={{ bottom: barPx + 5, color: isHovered ? 'var(--foreground)' : AMBER }}
                >
                  {formatMoney(month.amount)}
                </span>
              )}
              <div
                className="relative w-full max-w-8 rounded-[6px] transition-[filter]"
                style={{
                  height: barPx,
                  background: `linear-gradient(180deg,${AMBER},#b98c2e)`,
                  filter:
                    hoveredIndex !== null && !isHovered ? 'saturate(.45) brightness(.7)' : 'none',
                  boxShadow: isHovered ? '0 0 18px rgba(227,178,74,.35)' : 'none',
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5 border-t border-white/5 pt-1.75">
        {months.map((month, index) => (
          <div
            key={index}
            className="flex-1 text-center text-[10px]"
            style={{
              color: hoveredIndex === index ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontWeight: hoveredIndex === index ? 700 : 400,
            }}
          >
            {month.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
