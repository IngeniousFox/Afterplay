import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { floatingPanelClass } from '../../lib/styles';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export type Year = 'all' | number;

type YearPickerProps = {
  years: number[];
  value: Year;
  onChange: (year: Year) => void;
  // El Activity de un juego individual no ofrece "All Time" — un heatmap
  // siempre muestra una ventana acotada (52 semanas o un año), así que ahí
  // solo tiene sentido elegir ENTRE años reales, nunca "todo".
  includeAllTime?: boolean;
};

const optionClass =
  'flex w-full items-center justify-between rounded-sm px-2.75 py-2 text-left text-small font-semibold text-bone hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-phosphor';

// Desplegable de año compacto: la card de Activity de un juego individual
// (su propio filtro, independiente del de la página).
export const YearPicker = ({
  years,
  value,
  onChange,
  includeAllTime = true,
}: YearPickerProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const label = value === 'all' ? 'All time' : String(value);
  const options: Year[] = includeAllTime ? ['all', ...years] : years;
  // Con una sola opción no hay nada que elegir — el botón se queda como
  // etiqueta bloqueada (ej. un juego con sesiones en un único año).
  const disabled = options.length <= 1;

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex flex-none items-center gap-1.5 rounded-sm border border-line-strong bg-raised px-3 py-1.5 text-small font-semibold text-bone',
          'transition-colors hover:border-line-hover hover:bg-raised-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
          disabled && 'cursor-default opacity-55 hover:border-line-strong hover:bg-raised',
        )}
      >
        <span>{label}</span>
        <ChevronDown size={14} />
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
            className={optionClass}
          >
            <span>{year === 'all' ? 'All time' : year}</span>
            {year === value && <Check size={14} className="text-phosphor" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const tabClass = (active: boolean): string =>
  cn(
    'relative flex h-9 items-center rounded-sm px-3 text-body font-semibold whitespace-nowrap tabular-nums',
    'transition-colors duration-150 outline-hidden',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
    'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-phosphor after:transition-opacity',
    active
      ? 'bg-raised text-bone after:opacity-100'
      : 'text-dust after:opacity-0 hover:bg-raised/60 hover:text-bone',
  );

// Selector de rango de la cabecera de Stats (Fósforo): "All time", los años
// con actividad más recientes como pestañas y "More years" para el resto. La
// pestaña activa lleva fondo Raised y subrayado Phosphor; si el año elegido
// vive en el desplegable, el propio botón lo enseña como activo.
export const YearTabs = ({
  years,
  value,
  onChange,
  maxTabs = 6,
}: {
  years: number[];
  value: Year;
  onChange: (year: Year) => void;
  maxTabs?: number;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const visible = years.slice(0, maxTabs);
  const rest = years.slice(maxTabs);
  const restActive = value !== 'all' && rest.includes(value);

  return (
    <div className="afterplay-stats-years flex items-center gap-1" aria-label="Range">
      <button
        type="button"
        aria-pressed={value === 'all'}
        className={tabClass(value === 'all')}
        onClick={() => onChange('all')}
      >
        All time
      </button>
      {visible.map((year) => (
        <button
          key={year}
          type="button"
          aria-pressed={value === year}
          className={tabClass(value === year)}
          onClick={() => onChange(year)}
        >
          {year}
        </button>
      ))}
      {rest.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={cn(
              'ml-2 flex h-9 items-center gap-1.5 rounded-sm border px-3 text-body font-semibold whitespace-nowrap',
              'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
              restActive
                ? 'border-phosphor/60 bg-raised text-bone'
                : 'border-line-strong text-dust hover:border-line-hover hover:text-bone',
            )}
          >
            {restActive ? value : 'More years'}
            <ChevronDown size={14} />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className={`max-h-65 w-37.5 overflow-y-auto ${floatingPanelClass} p-1.5`}
          >
            {rest.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  onChange(year);
                  setOpen(false);
                }}
                className={optionClass}
              >
                <span>{year}</span>
                {year === value && <Check size={14} className="text-phosphor" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
