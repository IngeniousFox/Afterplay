import { useMemo } from 'react';
import { monthKey, twelveMonthWindow } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';
import { secondsByMonthOf, type SessionStats } from '../../../../shared/domain/sessionStats';
import { CategoryBarChart } from './CategoryBarChart';
import type { Year } from './YearPicker';

type HoursByMonthChartProps = {
  stats: Pick<SessionStats, 'days'>;
  year: Year;
};

// Horas jugadas por mes, 12 barras sobre la ventana compartida de Stats
// (twelveMonthWindow) y los mismos datos que el resto de gráficas de
// hábitos: solo sesiones medidas y cerradas (ver sessionStats.ts).
export const HoursByMonthChart = ({ stats, year }: HoursByMonthChartProps): React.JSX.Element => {
  const { bars, totalSeconds } = useMemo(() => {
    const secondsByKey = secondsByMonthOf(stats);

    const bars = twelveMonthWindow(year).map((date) => ({
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      value: secondsByKey.get(monthKey(date)) ?? 0,
    }));

    const totalSeconds = bars.reduce((sum, bar) => sum + bar.value, 0);

    return { bars, totalSeconds };
  }, [stats, year]);

  return (
    <CategoryBarChart
      title="Hours per month"
      subtitle="Your recent rhythm"
      headerRight={() => (
        <>
          <strong>{formatHours(totalSeconds / 3600)}</strong>
          <small>{year === 'all' ? 'last 12 months' : `${year} total`}</small>
        </>
      )}
      bars={bars}
      formatValue={(seconds) => formatHours(seconds / 3600)}
    />
  );
};
