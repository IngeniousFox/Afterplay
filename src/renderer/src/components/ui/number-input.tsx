import { cn } from '../../lib/utils';

// Fósforo (hoja 4): Inset + borde Edge + radio 4 + foco Phosphor con halo.
// Cada consumidor añade su ancho y su relleno; cn deja ganar sus clases.
const numberInputClass =
  'rounded-sm border border-edge bg-inset text-bone tabular-nums outline-hidden placeholder:text-dust transition-[border-color,box-shadow] duration-150 focus:border-phosphor focus:shadow-focus-field disabled:cursor-not-allowed disabled:opacity-40';

// input type="number" con el fix de rueda de ratón integrado — Chromium
// cambia el valor de un <input type="number"> con la rueda mientras tiene el
// foco, igual que si fueran las flechitas, pero sin ningún indicio visual de
// que ha pasado. Muy fácil de disparar sin querer al bajar por un modal con
// scroll justo después de escribir aquí (bug real reportado: "metí 68 y se
// guardó 65"). Quitar el foco al recibir la rueda deja que el scroll actúe
// sobre la página, no sobre el número. Compatible con register() (pasa el
// ref) y con Controller (spread de field).
export const NumberInput = ({
  ref,
  className,
  ...props
}: React.ComponentProps<'input'>): React.JSX.Element => (
  <input
    ref={ref}
    {...props}
    className={cn(numberInputClass, className)}
    type="number"
    onWheel={(event) => event.currentTarget.blur()}
  />
);
