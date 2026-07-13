import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { YearDropdown } from './YearDropdown';

type MonthGridProps = {
  value: Date | null;
  onSelect: (date: Date) => void;
};

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Rejilla de meses + año navegable — react-day-picker no trae un modo "solo
// mes" de fábrica, y montar un calendario de días completo para elegir un
// mes sería enseñar más de lo que hace falta.
export const MonthGrid = ({ value, onSelect }: MonthGridProps): React.JSX.Element => {
  const [year, setYear] = useState(value?.getFullYear() ?? new Date().getFullYear());

  return (
    <div className="w-56 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYear((current) => current - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft size={16} />
        </button>
        <YearDropdown year={year} onSelectYear={setYear} />
        <button
          type="button"
          onClick={() => setYear((current) => current + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTH_LABELS.map((label, index) => {
          const isSelected = value?.getFullYear() === year && value.getMonth() === index;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelect(new Date(year, index, 1))}
              className={cn(
                'rounded-md py-2 text-sm hover:bg-muted',
                isSelected ? 'font-semibold' : 'text-foreground',
              )}
              style={
                isSelected
                  ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                  : undefined
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
