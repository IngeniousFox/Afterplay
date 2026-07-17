import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils';

type YearGridProps = {
  value: number | null;
  // Año por el que arrancar navegado si `value` es null (misma idea que
  // MonthGrid.initialMonth). `value` manda si existe.
  initialYear?: number;
  onSelect: (year: number) => void;
};

const PAGE_SIZE = 12;
const CURRENT_YEAR = new Date().getFullYear();

// Mismo patrón visual que MonthGrid (rejilla + paginación con flechas), pero
// paginando por bloques de 12 años en vez de meses de un año. Lo que se
// registra aquí ya pasó, nunca es una fecha futura: ni se puede paginar más
// allá del bloque que contiene el año actual, ni elegir un año posterior
// dentro de ese bloque.
export const YearGrid = ({ value, initialYear, onSelect }: YearGridProps): React.JSX.Element => {
  const [pageStart, setPageStart] = useState(() => {
    const base = value ?? initialYear ?? CURRENT_YEAR;
    return base - (base % PAGE_SIZE);
  });
  const years = Array.from({ length: PAGE_SIZE }, (_, index) => pageStart + index);
  const isLastPage = pageStart + PAGE_SIZE > CURRENT_YEAR;

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
          disabled={isLastPage}
          onClick={() => setPageStart((current) => current + PAGE_SIZE)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {years.map((year) => {
          const isSelected = value === year;
          const isFuture = year > CURRENT_YEAR;
          return (
            <button
              key={year}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(year)}
              className={cn(
                'rounded-md py-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
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
