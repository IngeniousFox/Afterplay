import { ChevronDown } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from 'react';

type CalendarDropdownOption = { value: number; label: string; disabled: boolean };

type CalendarDropdownProps = {
  options?: CalendarDropdownOption[];
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'options'>;

// El calendario de día monta DOS CalendarDropdown a la vez (mes y año) — sin
// coordinarlos, cada uno lleva su propio abierto/cerrado y podían quedar los
// dos abiertos superpuestos a la vez (visto en vivo). Un id compartido por
// "cuál está abierto ahora mismo" basta: abrir uno cierra el otro solo.
type CoordinatorValue = { openId: string | null; setOpenId: (id: string | null) => void };
const CoordinatorContext = createContext<CoordinatorValue | null>(null);

export const CalendarDropdownGroup = ({ children }: { children: ReactNode }): React.JSX.Element => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <CoordinatorContext.Provider value={{ openId, setOpenId }}>
      {children}
    </CoordinatorContext.Provider>
  );
};

// Sustituye el <select> nativo que react-day-picker usa por defecto para el
// salto rápido de mes/año (captionLayout="dropdown") — el <select> en sí se
// puede estilizar, pero la LISTA que despliega al abrirlo la pinta el
// sistema operativo y no hereda el tema oscuro de la app (comprobado en
// vivo: fondo claro, texto casi invisible). Mismo contrato de props que su
// Dropdown interno (ver react-day-picker/dist/.../Dropdown.js), para poder
// enchufarlo tal cual vía `components={{ Dropdown: CalendarDropdown }}` sin
// perder el salto rápido — solo cambia cómo se pinta.
export const CalendarDropdown = ({
  options = [],
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: CalendarDropdownProps): React.JSX.Element => {
  const id = useId();
  const coordinator = useContext(CoordinatorContext);
  const open = coordinator?.openId === id;
  const setOpen = (next: boolean): void => coordinator?.setOpenId(next ? id : null);

  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => String(option.value) === String(value));

  // Al abrir, salta directo a la opción actual en vez de dejar la lista
  // arrancando por el primer valor (con el año acotado a 1970–hoy+1 son
  // ~55 filas — sin esto tocaría desplazar a mano hasta encontrar el año
  // de verdad).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);

  // react-day-picker solo lee `e.target.value` de este evento (ver su
  // handleMonthChange/handleYearChange) — no hace falta un evento real, un
  // objeto con esa forma es indistinguible para su lado.
  const emitChange = (optionValue: number): void => {
    onChange?.({ target: { value: String(optionValue) } } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        <span>{selected?.label}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute top-full left-0 z-40 mt-1 max-h-52 w-28 overflow-y-auto rounded-[10px] border border-input bg-[rgba(23,25,24,.99)] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
        >
          {options.map((option) => {
            const isSelected = String(option.value) === String(value);
            return (
              <div
                key={option.value}
                data-selected={isSelected}
                onClick={() => !option.disabled && emitChange(option.value)}
                className={`rounded-lg px-2.5 py-1.75 text-[13px] text-foreground ${
                  option.disabled
                    ? 'pointer-events-none opacity-40'
                    : 'cursor-pointer hover:bg-white/[0.06]'
                } ${isSelected ? 'bg-white/[0.06] font-semibold' : ''}`}
              >
                {option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
