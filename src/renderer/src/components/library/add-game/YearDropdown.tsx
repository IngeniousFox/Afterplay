import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';

type YearDropdownProps = {
  year: number;
  onSelectYear: (year: number) => void;
  minYear?: number;
  maxYear?: number;
};

const CURRENT_YEAR = new Date().getFullYear();

// Salto directo de año dentro de una cabecera de calendario compacta (ej.
// MonthGrid) — las flechas de al lado solo suman/restan de uno en uno, que
// para ir de 2026 a 1970 son 56 clics. Mismo look que CalendarDropdown (el
// del calendario de día) pero sin su contrato de eventos de react-day-picker,
// que aquí no hace falta — esto solo llama a onSelectYear con un número.
export const YearDropdown = ({
  year,
  onSelectYear,
  minYear = 1970,
  maxYear = CURRENT_YEAR + 1,
}: YearDropdownProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  // Al abrir, salta directo al año actual en vez de dejar la lista
  // arrancando por el primero — mismo motivo y mismo patrón que
  // CalendarDropdown.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md px-1.5 py-0.5 text-sm font-medium text-foreground hover:bg-muted"
      >
        {year}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute top-full left-1/2 z-40 mt-1 max-h-52 w-20 -translate-x-1/2 overflow-y-auto rounded-[10px] border border-input bg-[rgba(23,25,24,.99)] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
        >
          {years.map((option) => {
            const isSelected = option === year;
            return (
              <div
                key={option}
                data-selected={isSelected}
                onClick={() => {
                  onSelectYear(option);
                  setOpen(false);
                }}
                className={cn(
                  'cursor-pointer rounded-lg px-2.5 py-1.75 text-center text-[13px] text-foreground hover:bg-white/[0.06]',
                  isSelected && 'bg-white/[0.06] font-semibold',
                )}
              >
                {option}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
