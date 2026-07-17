import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';
import { formatDateOnly } from '../../../lib/format';
import { floatingPanelClass } from '../../../lib/styles';
import { Calendar } from '../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { CalendarDropdown, CalendarDropdownGroup } from './CalendarDropdown';
import { MonthGrid } from './MonthGrid';
import { CURRENT_YEAR, parseIsoDate, TODAY, toIsoDate } from './precisionDate';
import type { DatePrecision, PrecisionDateValue } from './precisionDate';
import { YearGrid } from './YearGrid';

export type { DatePrecision, PrecisionDateValue } from './precisionDate';

const CALENDAR_START_MONTH = new Date(1970, 0);
const CALENDAR_END_MONTH = new Date(CURRENT_YEAR, 11);

type DateWithPrecisionPickerProps = {
  label: string;
  value: PrecisionDateValue | null;
  onChange: (value: PrecisionDateValue | null) => void;
  // Mes/año por el que arrancar navegado la PRIMERA vez que se abre sin
  // `value` todavía — pensado para el picker de "Finished" cuando "Started"
  // ya tiene fecha: se abre en ese mismo mes, sin seleccionar nada.
  // `value`, si existe, siempre manda sobre esto.
  defaultMonth?: Date;
};

const PRECISION_OPTIONS: { value: DatePrecision; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const formatDisplay = (value: PrecisionDateValue): string =>
  formatDateOnly(parseIsoDate(value.isoDate), value.precision);

// Selector de precisión (Day/Month/Year) + un picker de verdad para cada una
// — calendario para día (shadcn/react-day-picker), rejilla de meses o de
// años para las otras dos. Pensado para reutilizarse tal cual en el modal de
// editar (2G), que pide lo mismo.
export const DateWithPrecisionPicker = ({
  label,
  value,
  onChange,
  defaultMonth,
}: DateWithPrecisionPickerProps): React.JSX.Element => {
  // Solo importa mientras value es null: qué picker enseñar hasta que el
  // usuario elija algo. En cuanto hay value, manda su propia precisión.
  const [pendingPrecision, setPendingPrecision] = useState<DatePrecision>('day');
  const [open, setOpen] = useState(false);
  const precision = value?.precision ?? pendingPrecision;

  return (
    <div className="flex-1">
      <div className="mb-1.75 flex items-center justify-between">
        <span className="text-[11.5px] font-bold tracking-[.05em] text-muted-foreground">
          {label}
        </span>
        <div className="flex gap-0.5">
          {PRECISION_OPTIONS.map((option) => {
            const isActive = precision === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setPendingPrecision(option.value);
                  if (value) onChange({ ...value, precision: option.value });
                }}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={
                  isActive
                    ? { background: 'rgba(47,220,126,.15)', color: '#2fdc7e' }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="flex w-full min-w-0 items-center gap-2 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2.5 text-left text-[13px] text-foreground">
            <CalendarIcon size={14} className="flex-none text-muted-foreground" />
            <span className={`truncate ${value ? '' : 'text-muted-foreground/70'}`}>
              {value ? formatDisplay(value) : 'Not set'}
            </span>
          </PopoverTrigger>
          <PopoverContent className={`w-auto ${floatingPanelClass} p-0`}>
            {precision === 'day' && (
              // captionLayout="dropdown" para poder saltar rápido de mes/año
              // — react-day-picker lo implementa con un <select> nativo por
              // defecto, y la lista que despliega el navegador la pinta el
              // sistema operativo, sin heredar el tema oscuro de la app
              // (comprobado en vivo: fondo claro, texto casi invisible).
              // CalendarDropdown sustituye ESE componente interno por uno
              // propio con el mismo contrato de props — se mantiene el salto
              // rápido, cambia solo cómo se pinta.
              <CalendarDropdownGroup>
                <Calendar
                  mode="single"
                  captionLayout="dropdown"
                  // Sin esto, react-day-picker calcula cuántas semanas pintar
                  // según cómo caiga el mes (4 a 6 filas) — un popover más
                  // bajo en meses "cortos" cabe debajo del input, pero en un
                  // mes de 6 filas se sale y el propio Popover lo voltea
                  // arriba (bug real: "en algunos meses concretos aparece
                  // arriba"). Fijar siempre 6 filas deja la altura constante,
                  // así el popover no cambia de lado mes a mes.
                  fixedWeeks
                  startMonth={CALENDAR_START_MONTH}
                  endMonth={CALENDAR_END_MONTH}
                  disabled={{ after: TODAY }}
                  components={{ Dropdown: CalendarDropdown }}
                  selected={value ? parseIsoDate(value.isoDate) : undefined}
                  // Sin esto, aunque `selected` ya tenga una fecha, react-day-
                  // picker abre siempre en el mes de HOY — hacía falta
                  // decirle explícitamente en qué mes navegar al montar
                  // (bug real: "si se vuelve a abrir con una fecha ya puesta
                  // debería estar en ese momento"). Si tampoco hay value,
                  // cae a defaultMonth (p.ej. el mes de "Started", para que
                  // "Finished" abra ahí sin seleccionar nada).
                  defaultMonth={value ? parseIsoDate(value.isoDate) : defaultMonth}
                  onSelect={(date) => {
                    if (!date) return;
                    onChange({ precision: 'day', isoDate: toIsoDate(date) });
                    setOpen(false);
                  }}
                />
              </CalendarDropdownGroup>
            )}
            {precision === 'month' && (
              <MonthGrid
                value={value ? parseIsoDate(value.isoDate) : null}
                initialMonth={defaultMonth}
                onSelect={(date) => {
                  onChange({ precision: 'month', isoDate: toIsoDate(date) });
                  setOpen(false);
                }}
              />
            )}
            {precision === 'year' && (
              <YearGrid
                value={value ? parseIsoDate(value.isoDate).getFullYear() : null}
                initialYear={defaultMonth?.getFullYear()}
                onSelect={(year) => {
                  onChange({ precision: 'year', isoDate: `${year}-01-01` });
                  setOpen(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>

        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="flex flex-none items-center justify-center rounded-[9px] border border-input bg-white/[0.03] px-2.5 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
