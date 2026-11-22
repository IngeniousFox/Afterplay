import type { StateType } from '../api';
import { cn } from '../lib/cn';
import { ledClass } from '../lib/styles';

// Una cifra de Fósforo: Big Shoulders, y las unidades ("h", "m") a 0.45 em en
// Dust, peso 600. Solo las letras que siguen a un número son unidad, así que
// vale para "23h 15m", "38", "1:12:04" o "€49.99"; un texto sin cifras
// ("Free") se pinta entero.
export const Figure = ({
  value,
  className,
  unitClassName = 'text-dust',
}: {
  value: string;
  className?: string;
  unitClassName?: string;
}): React.JSX.Element => {
  const parts = /\d/.test(value)
    ? value.split(/([a-z]+\s*)/i).filter((part) => part !== '')
    : [value];
  return (
    <span className={cn('font-display font-bold tabular-nums', className)}>
      {parts.map((part, index) =>
        !/^[a-z]+\s*$/i.test(part) || parts.length === 1 ? (
          <span key={index}>{part}</span>
        ) : (
          <span
            key={index}
            className={cn(
              'ml-px text-[length:max(12px,0.45em)] font-semibold whitespace-pre',
              unitClassName,
            )}
          >
            {part}
          </span>
        ),
      )}
    </span>
  );
};

// El LED de estado de un juego. Va siempre junto a su palabra: el color solo
// no basta para leerlo.
export const Led = ({
  state,
  className,
}: {
  state: StateType | null;
  className?: string;
}): React.JSX.Element => (
  <span
    aria-hidden="true"
    className={cn('inline-block size-2 shrink-0 rounded-full', ledClass(state), className)}
  />
);

// El punto rojo de "en marcha ahora", con su latido (quieto si se pide
// movimiento reducido).
export const LiveDot = ({ className }: { className?: string }): React.JSX.Element => (
  <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0', className)}>
    <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
    <span className="relative size-2 animate-led-live rounded-full bg-live motion-reduce:animate-none" />
  </span>
);
