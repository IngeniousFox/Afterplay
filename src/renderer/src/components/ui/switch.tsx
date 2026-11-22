import { cn } from '@/lib/utils';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  // Sin texto visible al lado (la fila ya lo dice): el nombre accesible.
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
  className?: string;
};

// Interruptor de Fósforo (hoja 5, sistema-controles-seleccion.png): pista de
// 38 x 22 px, encendido en Phosphor con la bola en tinta, apagado en Raised
// con la bola en Dust. Es un botón con role="switch" para que el lector de
// pantalla diga "activado/desactivado" y Espacio/Enter lo alternen.
export const Switch = ({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  ...aria
}: SwitchProps): React.JSX.Element => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    {...aria}
    className={cn(
      'relative inline-flex h-5.5 w-9.5 flex-none items-center rounded-full border transition-[background-color,border-color] duration-150 ease-out',
      'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
      'disabled:cursor-not-allowed disabled:opacity-40',
      checked
        ? 'border-phosphor bg-phosphor enabled:hover:bg-phosphor-hi'
        : 'border-line-strong bg-raised enabled:hover:border-line-hover',
      className,
    )}
  >
    <span
      aria-hidden
      className={cn(
        'absolute left-0.5 size-4 rounded-full transition-[transform,background-color] duration-200 ease-out motion-reduce:transition-none',
        checked ? 'translate-x-4 bg-ink' : 'translate-x-0 bg-dust',
      )}
    />
  </button>
);
