import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils';

type YearGridProps = {
  value: number | null;
  onSelect: (year: number) => void;
};

const PAGE_SIZE = 12;

// Mismo patrón visual que MonthGrid (rejilla + paginación con flechas), pero
// paginando por bloques de 12 años en vez de meses de un año.
export const YearGrid = ({ value, onSelect }: YearGridProps): React.JSX.Element => {
  const [pageStart, setPageStart] = useState(() => {
    const base = value ?? new Date().getFullYear();
    return base - (base % PAGE_SIZE);
  });
  const years = Array.from({ length: PAGE_SIZE }, (_, index) => pageStart + index);

  return (
    <div className="w-56 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPageStart((current) => current - PAGE_SIZE)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-foreground">
          {years[0]} – {years[years.length - 1]}
        </span>
        <button
          type="button"
          onClick={() => setPageStart((current) => current + PAGE_SIZE)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {years.map((year) => {
          const isSelected = value === year;
          return (
            <button
              key={year}
              type="button"
              onClick={() => onSelect(year)}
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
              {year}
            </button>
          );
        })}
      </div>
    </div>
  );
};
