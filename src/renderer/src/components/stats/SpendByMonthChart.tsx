import { useMemo } from 'react';
import { AMBER } from '../../lib/colors';
import { formatMoney } from '../../lib/format';
import { CategoryBarChart } from './CategoryBarChart';
import type { Year } from './YearPicker';

type ChartSpendEvent = {
  amount: number;
  occurredAt: Date;
};

type SpendByMonthChartProps = {
  spendEvents: ChartSpendEvent[];
  year: Year;
};

const monthKey = (year: number, month: number): number => year * 12 + month;

// El gemelo de Hours per month pero con euros — misma ventana ("All Time" =
// últimos 12 meses, un año concreto = enero a diciembre), mismas barras;
// cambia el color (el ámbar del gasto, como en History) y que aquí se suman
// importes, no duraciones. Las rebajas de Steam salen como picos clavados.
export const SpendByMonthChart = ({
  spendEvents,
  year,
}: SpendByMonthChartProps): React.JSX.Element => {
  const { bars, totalAmount } = useMemo(() => {
    const now = new Date();
    const firstMonth =
      year === 'all' ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(year, 0, 1);

    const amountByKey = new Map<number, number>();
    for (const event of spendEvents) {
      const key = monthKey(event.occurredAt.getFullYear(), event.occurredAt.getMonth());
      amountByKey.set(key, (amountByKey.get(key) ?? 0) + event.amount);
    }

    const bars = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
      return {
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        value: amountByKey.get(monthKey(date.getFullYear(), date.getMonth())) ?? 0,
      };
    });

    const totalAmount = bars.reduce((sum, bar) => sum + bar.value, 0);

    return { bars, totalAmount };
  }, [spendEvents, year]);

  return (
    <CategoryBarChart
      title="Spent per month"
      headerRight={() => (
        <>
          {formatMoney(totalAmount)} {year === 'all' ? 'in the last 12 months' : `in ${year}`}
        </>
      )}
      bars={bars}
      formatValue={formatMoney}
      barGradient={`linear-gradient(180deg,${AMBER},#b98c2e)`}
      labelColor={AMBER}
      glowColor="rgba(227,178,74,.35)"
    />
  );
};
