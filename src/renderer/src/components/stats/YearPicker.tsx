import { Calendar, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { floatingPanelClass } from '../../lib/styles';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export type Year = 'all' | number;

type YearPickerProps = {
  years: number[];
  value: Year;
  onChange: (year: Year) => void;
  // Versión pequeña para meterlo en la cabecera de una card (ej. el
  // Activity de un juego individual) en vez de junto al título de la
  // página entera.
  compact?: boolean;
  // El Activity de un juego individual no ofrece "All Time" — un heatmap
  // siempre muestra una ventana acotada (52 semanas o un año), así que ahí
  // solo tiene sentido elegir ENTRE años reales, nunca "todo".
  includeAllTime?: boolean;
};

// Bloque 5B/5F — mismo desplegable de año en dos sitios: la cabecera de
// Stats (todo el panel) y, ahora, la card de Activity de un juego
// individual (su propio filtro, independiente del de la página).
export const YearPicker = ({
  years,
  value,
  onChange,
  compact = false,
  includeAllTime = true,
}: YearPickerProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const label = value === 'all' ? 'All Time' : String(value);
  const options: Year[] = includeAllTime ? ['all', ...years] : years;
  // Con una sola opción no hay nada que elegir — el botón se queda como
  // etiqueta bloqueada (ej. un juego con sesiones en un único año).
  const disabled = options.length <= 1;

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={`${
          compact
            ? 'flex flex-none items-center gap-1.25 rounded-[7px] border border-input bg-white/[0.03] px-2.25 py-1 text-[11.5px] font-bold text-foreground hover:bg-white/[0.06]'
            : 'flex flex-none items-center gap-2.25 rounded-[10px] border border-input bg-white/[0.03] px-3.75 py-2.25 text-[13.5px] font-bold text-foreground hover:bg-white/[0.06]'
        }${disabled ? ' cursor-default opacity-55 hover:bg-white/[0.03]' : ''}`}
      >
        <Calendar size={compact ? 11 : 15} />
        <span>{label}</span>
        <ChevronDown size={compact ? 11 : 15} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={`max-h-65 w-37.5 overflow-y-auto ${floatingPanelClass} p-1.5`}
      >
        {options.map((year) => (
          <button
            key={year}
            type="button"
            onClick={() => {
              onChange(year);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-[8px] px-2.75 py-2.25 text-left text-[13.5px] font-semibold text-foreground hover:bg-white/[0.06]"
          >
            <span>{year === 'all' ? 'All Time' : year}</span>
            {year === value && <Check size={14} className="text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
