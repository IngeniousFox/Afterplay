import { useMemo } from 'react';
import { GREEN } from '../../lib/colors';
import { monthKey, twelveMonthWindow } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';
import { hasMeasuredDuration } from '../../lib/sessionStats';
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

// Horas jugadas por mes, 12 barras sobre la ventana compartida de Stats
// (twelveMonthWindow) y los mismos datos que el resto de gráficas de
// hábitos: solo sesiones medidas y cerradas (ver sessionStats.ts).
export const HoursByMonthChart = ({
  sessions,
  year,
}: HoursByMonthChartProps): React.JSX.Element => {
  const { bars, totalSeconds } = useMemo(() => {
    const secondsByKey = new Map<number, number>();
    for (const session of sessions) {
      if (!hasMeasuredDuration(session)) continue;
      const key = monthKey(session.startedAt);
      secondsByKey.set(key, (secondsByKey.get(key) ?? 0) + (session.durationSec ?? 0));
    }

    const bars = twelveMonthWindow(year).map((date) => ({
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      value: secondsByKey.get(monthKey(date)) ?? 0,
    }));

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
