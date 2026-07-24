import { useMemo } from 'react';
import { GREEN } from '../../lib/colors';
import { formatHours } from '../../lib/format';
import { CategoryBarChart } from './CategoryBarChart';
import type { Year } from './YearPicker';

type ChartSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

type HoursByMonthChartProps = {
  sessions: ChartSession[];
  year: Year;
};

const monthKey = (year: number, month: number): number => year * 12 + month;

// Horas jugadas por mes, 12 barras. Misma regla de ventana que el Activity
// heatmap: "All Time" = los últimos 12 meses terminando en el actual
// (actividad reciente, no toda la vida apelotonada), un año concreto = sus
// 12 meses de enero a diciembre. Y mismos datos que el heatmap: solo
// sesiones trackeadas de verdad (isManual false) y cerradas.
export const HoursByMonthChart = ({
  sessions,
  year,
}: HoursByMonthChartProps): React.JSX.Element => {
  const { bars, totalSeconds } = useMemo(() => {
    const now = new Date();
    const firstMonth =
      year === 'all' ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(year, 0, 1);

    const secondsByKey = new Map<number, number>();
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      const key = monthKey(session.startedAt.getFullYear(), session.startedAt.getMonth());
      secondsByKey.set(key, (secondsByKey.get(key) ?? 0) + (session.durationSec ?? 0));
    }

    const bars = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
      return {
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        value: secondsByKey.get(monthKey(date.getFullYear(), date.getMonth())) ?? 0,
      };
    });

    const totalSeconds = bars.reduce((sum, bar) => sum + bar.value, 0);

    return { bars, totalSeconds };
  }, [sessions, year]);

  return (
    <CategoryBarChart
      title="Hours per month"
      headerRight={() => (
        <>
          {formatHours(totalSeconds / 3600)}{' '}
          {year === 'all' ? 'in the last 12 months' : `in ${year}`}
        </>
      )}
      bars={bars}
      formatValue={(seconds) => formatHours(seconds / 3600)}
      barGradient="linear-gradient(180deg,var(--ac),var(--ac2))"
      labelColor={GREEN}
      glowColor="rgba(47,220,126,.35)"
    />
  );
};
