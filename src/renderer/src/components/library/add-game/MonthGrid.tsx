import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { today } from './precisionDate';
import { YearDropdown } from './YearDropdown';

type MonthGridProps = {
  value: Date | null;
  // Año por el que arrancar navegado si `value` es null (p.ej. el año de
  // "Started" para que "Finished" abra ahí sin seleccionar nada). `value`
  // manda si existe.
  initialMonth?: Date;
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
// mes sería enseñar más de lo que hace falta. Lo que se registra aquí ya
// pasó, nunca es una fecha futura: ni el año ni, dentro del año actual, los
// meses todavía no llegados se pueden elegir.
export const MonthGrid = ({ value, initialMonth, onSelect }: MonthGridProps): React.JSX.Element => {
  // El "ahora" se lee en cada render y no al importar el módulo: la app se
  // queda abierta días, y con el mes congelado al arranque el mes en curso
  // salía gris al cruzar medianoche del día 1 (ver precisionDate).
  const now = today();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [year, setYear] = useState(
    value?.getFullYear() ?? initialMonth?.getFullYear() ?? currentYear,
  );

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
          disabled={year >= currentYear}
          onClick={() => setYear((current) => current + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTH_LABELS.map((label, index) => {
          const isSelected = value?.getFullYear() === year && value.getMonth() === index;
          const isFuture = year > currentYear || (year === currentYear && index > currentMonth);
          return (
            <button
              key={label}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(new Date(year, index, 1))}
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
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
