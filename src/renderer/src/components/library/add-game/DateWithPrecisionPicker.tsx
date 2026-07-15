import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';
import { Calendar } from '../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { CalendarDropdown, CalendarDropdownGroup } from './CalendarDropdown';
import { MonthGrid } from './MonthGrid';
import { YearGrid } from './YearGrid';

// Sin esto, react-day-picker arranca el desplegable de año en "hace 100
// años" por defecto (documentado, y comprobado en vivo: con hoy en 2026
// abría en 1926). El tope de arriba es HOY, no hoy+1: lo que se registra
// aquí (sesiones, gastos, cambios de estado) ya pasó, nunca es una fecha
// futura — mismo criterio en los tres pickers (día/mes/año, ver
// MonthGrid/YearGrid/YearDropdown).
const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const CALENDAR_START_MONTH = new Date(1970, 0);
const CALENDAR_END_MONTH = new Date(CURRENT_YEAR, 11);

export type DatePrecision = 'year' | 'month' | 'day';

// isoDate va SIEMPRE completo (YYYY-MM-DD) — la parte que no pinta según la
// precisión (mes/día cuando precision es 'year', día cuando es 'month')
// simplemente se rellena a 01 y no se muestra ni se usa aguas abajo: el
// timestamp guardado en sessions/stateEvents es siempre completo, precision
// solo dice cuánto de ese timestamp es de fiar (mismo modelo que ya usan
// esas tablas — no es un formato nuevo, es lo mismo con otro envoltorio).
export type PrecisionDateValue = { precision: DatePrecision; isoDate: string };

type DateWithPrecisionPickerProps = {
  label: string;
  value: PrecisionDateValue | null;
  onChange: (value: PrecisionDateValue | null) => void;
};

const PRECISION_OPTIONS: { value: DatePrecision; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

// isoDate es "YYYY-MM-DD" en hora local a propósito (sin sufijo Z) — parsear
// como fecha+hora local evita el clásico desfase de un día que da
// `new Date('YYYY-MM-DD')` (eso lo interpreta como UTC medianoche y lo
// muestra un día antes en husos horarios negativos).
const parseIsoDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00`);

const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// 'en-US' fijo, no el locale del sistema — el resto de la UI está en inglés
// sin i18n, así que dejar que esto cambie de idioma solo (el navegador de
// pruebas de Claude Code está en es-ES, y salía "15 de julio de 2026" aquí
// en medio de una interfaz en inglés) sería inconsistente.
const formatDisplay = (value: PrecisionDateValue): string => {
  const date = parseIsoDate(value.isoDate);
  if (value.precision === 'year') return String(date.getFullYear());
  if (value.precision === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Selector de precisión (Day/Month/Year) + un picker de verdad para cada una
// — calendario para día (shadcn/react-day-picker), rejilla de meses o de
// años para las otras dos. Pensado para reutilizarse tal cual en el modal de
// editar (2G), que pide lo mismo.
export const DateWithPrecisionPicker = ({
  label,
  value,
  onChange,
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
          <PopoverContent className="w-auto border-input bg-[rgba(23,25,24,.99)] p-0 shadow-[0_18px_50px_rgba(0,0,0,.55)]">
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
                  startMonth={CALENDAR_START_MONTH}
                  endMonth={CALENDAR_END_MONTH}
                  disabled={{ after: TODAY }}
                  components={{ Dropdown: CalendarDropdown }}
                  selected={value ? parseIsoDate(value.isoDate) : undefined}
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
                onSelect={(date) => {
                  onChange({ precision: 'month', isoDate: toIsoDate(date) });
                  setOpen(false);
                }}
              />
            )}
            {precision === 'year' && (
              <YearGrid
                value={value ? parseIsoDate(value.isoDate).getFullYear() : null}
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
