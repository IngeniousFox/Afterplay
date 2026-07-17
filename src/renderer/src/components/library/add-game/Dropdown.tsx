import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { floatingPanelClass } from '../../../lib/styles';

type DropdownProps<T extends string> = {
  value: T;
  options: T[];
  onChange: (value: T) => void;
  renderOption: (option: T) => React.ReactNode;
  openDirection?: 'down' | 'up';
};

// Botón + panel flotante genérico, usado tanto para el dropdown de
// plataforma (opciones de texto plano) como el de estado pasado (opciones
// con icono + color) — renderOption decide cómo se pinta cada una, este
// componente solo gestiona abrir/cerrar y la posición del panel.
export const Dropdown = <T extends string>({
  value,
  options,
  onChange,
  renderOption,
  openDirection = 'down',
}: DropdownProps<T>): React.JSX.Element => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2.5 text-[13.5px] font-semibold text-foreground"
      >
        <span>{renderOption(value)}</span>
        <ChevronDown size={16} className="text-muted-foreground" />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-40 max-h-52 w-full overflow-y-auto rounded-[11px] border ${floatingPanelClass} p-1.5 ${
            openDirection === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {options.map((option) => (
            <div
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="cursor-pointer rounded-lg px-2.75 py-2.25 text-[13.5px] text-foreground hover:bg-white/[0.06]"
            >
              {renderOption(option)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
