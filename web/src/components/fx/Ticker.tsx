import { useState } from 'react';
import { cn } from '../../lib/cn';
import { EASE, prefersReducedMotion } from './motion';
import { changedChars, useCountUp } from './useCountUp';

// TICKER: una cifra que entra contando hasta su valor, como un marcador.
//
//   <Ticker value={331} />
//   <Ticker value={hours} format={formatHours} render={(text) => <Figure value={text} />} />
//
// `format` recibe el número intermedio y devuelve el texto (por defecto,
// entero redondeado); `render` pinta ese texto (cifras con unidades
// pequeñas). Estado en reposo completo: el conteo es aria-hidden y el valor
// final va aparte en sr-only y en data-value, así que un lector de pantalla,
// una captura o un test nunca leen un número intermedio. Reduced motion: sin
// conteo.

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
  render?: (text: string) => React.ReactNode;
  duration?: number;
  from?: 'zero' | 'previous';
  className?: string;
}): React.JSX.Element => {
  const animated = useCountUp(value, duration, { from });
  const text = format(animated);
  return (
    <span className={className} data-value={format(value)}>
      <span aria-hidden="true">{render ? render(text) : text}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
};

// El dígito nuevo cae desde arriba. WAAPI sobre el span recién montado (solo
// transform y opacity; el escritorio añade un blur que aquí no compensa).
const dropIn = (node: HTMLSpanElement | null): void => {
  if (!node || typeof node.animate !== 'function') return;
  const reduced = prefersReducedMotion();
  node.animate(
    reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateY(-0.38em)' },
          { offset: 0.6, opacity: 1 },
          { opacity: 1, transform: 'none' },
        ],
    { duration: reduced ? 160 : 280, easing: EASE.out, fill: 'backwards' },
  );
};

// ODOMETER: un texto con cifras ("01:23:45") cuyos dígitos nuevos caen al
// cambiar; los que no cambian se quedan quietos. Al montar no anima nada.
// El textContent sigue siendo exactamente `value`.
//
//   <Odometer value={formatElapsed(seconds)} />
export const Odometer = ({
  value,
  className,
}: {
  value: string;
  className?: string;
}): React.JSX.Element => {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<string | null>(null);
  if (value !== current) {
    setPrevious(current);
    setCurrent(value);
  }
  const changed = changedChars(previous, value);

  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      {Array.from(value, (char, index) => (
        <span
          // La clave incluye el carácter: un dígito nuevo es un span nuevo, y
          // su ref lo anima al montarse.
          key={`${value.length - index}-${char}`}
          ref={changed[index] ? dropIn : undefined}
          className="inline-block whitespace-pre"
        >
          {char}
        </span>
      ))}
    </span>
  );
};
