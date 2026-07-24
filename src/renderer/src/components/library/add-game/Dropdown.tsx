import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { floatingPanelClass } from '../../../lib/styles';

type DropdownProps<T extends string> = {
  value: T;
  options: T[];
  onChange: (value: T) => void;
  renderOption: (option: T) => React.ReactNode;
  openDirection?: 'down' | 'up';
  // Con listas largas (plataformas): un input arriba del panel que filtra
  // las opciones escribiendo. Los dropdowns cortos (estado, año) no lo
  // necesitan y conservan su panel de siempre.
  searchable?: boolean;
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
  searchable = false,
}: DropdownProps<T>): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.toLowerCase().includes(normalizedQuery))
    : options;

  const optionRows = visibleOptions.map((option) => {
    const isSelected = option === value;
    return (
      <div
        key={option}
        onClick={() => {
          onChange(option);
          close();
        }}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.75 py-2.25 text-[13.5px] transition-colors duration-100 hover:bg-white/[0.07] ${
          isSelected ? 'text-primary' : 'text-foreground'
        }`}
        style={isSelected ? { background: 'rgba(47,220,126,.08)' } : undefined}
      >
        {renderOption(option)}
        {isSelected && <Check size={14} className="flex-none text-primary" />}
      </div>
    );
  });

  const panelAnimationClass = `animate-in fade-in-0 duration-150 ${
    openDirection === 'up' ? 'slide-in-from-bottom-1' : 'slide-in-from-top-1'
  }`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center justify-between rounded-[9px] border px-3.25 py-2.5 text-[13.5px] font-semibold text-foreground transition-[border-color,background-color,box-shadow] duration-150"
        style={
          open
            ? {
                borderColor: 'rgba(47,220,126,.45)',
                background: 'rgba(255,255,255,.05)',
                boxShadow: '0 0 0 3px rgba(47,220,126,.12)',
              }
            : { borderColor: 'var(--input)', background: 'rgba(255,255,255,.03)' }
        }
      >
        <span>{renderOption(value)}</span>
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && !searchable && (
        <div
          className={`absolute left-0 z-40 flex max-h-52 w-full flex-col gap-0.75 overflow-y-auto rounded-[11px] border ${floatingPanelClass} p-1.5 ${panelAnimationClass} ${
            openDirection === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {optionRows}
        </div>
      )}
      {open && searchable && (
        <div
          className={`absolute left-0 z-40 flex w-full flex-col rounded-[11px] border ${floatingPanelClass} p-1.5 ${panelAnimationClass} ${
            openDirection === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type to filter…"
            className="mb-1.5 w-full rounded-lg border border-input bg-white/[0.03] px-2.75 py-2 text-[13px] text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary/45 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(47,220,126,.12)]"
          />
          <div className="flex max-h-52 flex-col gap-0.75 overflow-y-auto">
            {optionRows.length > 0 ? (
              optionRows
            ) : (
              <div className="px-2.75 py-2.25 text-[12.5px] text-muted-foreground">No matches.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
