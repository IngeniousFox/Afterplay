import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCountUp } from '../../hooks/useCountUp';
import { changedChars } from './odometer';

// TICKER: una cifra que entra contando hasta su valor, como un marcador.
//
//   <Ticker value={331} />
//   <Ticker value={hours} format={formatHours} className="text-stat" />
//   <Ticker value={n} from="previous" />        cuenta desde lo que se veía
//   <Ticker value={secs} render={(v) => <Figure value={fmt(v)} />} />
//
// Respeta el formato de siempre: `format` recibe el número intermedio (sin
// redondear) y devuelve el texto; por defecto, entero redondeado. Con
// `render` pintas tú el valor (cifras con unidades pequeñas, etc.).
//
// Estado en reposo completo: el conteo es aria-hidden y el valor final va
// aparte en sr-only y en data-value, así que un lector de pantalla, un e2e o
// una captura nunca leen un número intermedio. Reduced motion: sin conteo.
// Para leer el valor en un e2e: `[data-value]` o el texto accesible.

const round = (value: number): string => String(Math.round(value));

export const Ticker = ({
  value,
  format = round,
  render,
  duration = 700,
  from = 'zero',
  className,
}: {
  value: number;
  format?: (value: number) => string;
  render?: (value: number) => React.ReactNode;
  duration?: number;
  from?: 'zero' | 'previous';
  className?: string;
}): React.JSX.Element => {
  const animated = useCountUp(value, duration, { from });
  return (
    <span className={className} data-value={format(value)}>
      <span aria-hidden>{render ? render(animated) : format(animated)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
};

// ODOMETER: un texto con cifras (un cronómetro "01:23:45") cuyos dígitos
// nuevos caen desde arriba con un poco de estela al cambiar. Los que no
// cambian se quedan quietos.
//
//   <Odometer value={formatElapsed(elapsed)} className="font-display …" />
//
// Cada carácter es un span inline: hereda fuente, color y el bloom de un
// GlowText que lo envuelva (no recorta el brillo). Al montar no anima nada;
// solo los cambios. Reduced motion: el dígito nuevo aparece con fundido, sin
// recorrido (--digit-y en fosforo.css).
export const Odometer = ({
  value,
  className,
}: {
  value: string;
  className?: string;
}): React.JSX.Element => {
  // "Estado derivado del anterior" con el patrón que React admite en render:
  // se guarda el valor previo en estado y se actualiza al detectar cambio.
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<string | null>(null);
  if (value !== current) {
    setPrevious(current);
    setCurrent(value);
  }
  const changed = changedChars(previous, value);

  return (
    // Sin copia en sr-only: los spans en línea se leen como un solo texto y el
    // textContent sigue siendo exactamente `value` (los e2e lo leen así).
    <span className={cn('inline-flex tabular-nums', className)}>
      {Array.from(value, (char, index) => (
        <span
          // La clave incluye el carácter: un dígito nuevo es un span nuevo, y
          // su animación de entrada arranca sola al montar.
          key={`${value.length - index}-${char}`}
          className={cn('inline-block', changed[index] && 'animate-digit-in')}
        >
          {char}
        </span>
      ))}
    </span>
  );
};
