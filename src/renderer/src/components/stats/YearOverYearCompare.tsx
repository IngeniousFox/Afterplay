import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { formatHours, formatMoney } from '../../lib/format';

export type YearMetrics = {
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
};

export type YearComparisonBaseline = { year: number; metrics: YearMetrics };

type YearMetricComparisonProps = {
  metric: keyof YearMetrics;
  current: number | null;
  previous: number | null;
  previousYear: number;
};

// Keep each comparison attached to the value it explains. The caller only
// supplies a baseline when that previous year actually has recorded activity.
export const YearMetricComparison = ({
  metric,
  current,
  previous,
  previousYear,
}: YearMetricComparisonProps): React.JSX.Element => {
  const delta = current !== null && previous !== null ? current - previous : null;
  const threshold = metric === 'totalGames' ? 1 : metric === 'totalHours' ? 0.05 : 0.005;
  const unchanged = delta !== null && Math.abs(delta) < threshold;
  const inverse = metric === 'totalSpent' || metric === 'costPerHour';
  const favorable = delta !== null && (inverse ? delta < 0 : delta > 0);
  const neutral = delta === null || unchanged;
  const Icon = neutral ? Minus : favorable ? TrendingUp : TrendingDown;
  const color = neutral ? 'var(--muted-foreground)' : favorable ? '#2fdc7e' : '#e85d72';
  let label: string;
  if (delta === null) label = `No comparison for ${previousYear}`;
  else if (unchanged) label = `Same as ${previousYear}`;
  else if (metric === 'totalGames') {
    label = `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than ${previousYear}`;
  } else if (metric === 'totalHours') {
    label = `${formatHours(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${previousYear}`;
  } else if (metric === 'totalSpent') {
    label = `${formatMoney(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${previousYear}`;
  } else {
    label = `${formatMoney(Math.abs(delta))} ${delta > 0 ? 'more' : 'cheaper'} per hour vs ${previousYear}`;
  }

  return (
    <div
      className="mt-2 flex min-w-0 items-start gap-1.5 text-[11px] leading-4"
      data-year-comparison={metric}
    >
      <Icon size={12} className="mt-0.5 flex-none" style={{ color }} />
      <span className="min-w-0 font-semibold text-white/65">{label}</span>
    </div>
  );
};
