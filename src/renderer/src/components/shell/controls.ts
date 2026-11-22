import { cn } from '@/lib/utils';

// Los controles de Fósforo que usan el armazón, Home y Library
// (docs/redesign/concepts/b-fosforo/README-sistema.md, hojas 4 y 5). Viven
// aquí mientras components/ui se migra en otra tanda: cuando Button tenga sus
// variantes de Fósforo, estas clases pueden irse a él.

// Foco: outline Phosphor de 2 px con 2 px de separación, nunca un relleno.
export const focusRing =
  'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor';

// Dentro de filas, pestañas y menús el outline va hacia dentro para que los
// vecinos no lo recorten.
export const focusRingInset =
  'outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor';

// Pulsar = scale(.97); con reduced motion no hay escala.
const press = 'active:scale-[.97] motion-reduce:active:scale-100';

const buttonBase = cn(
  'inline-flex flex-none items-center justify-center gap-2 rounded-sm font-semibold whitespace-nowrap select-none',
  'transition-[background-color,border-color,color,transform] duration-150 ease-out',
  'disabled:cursor-not-allowed disabled:opacity-40',
  press,
  focusRing,
);

export const buttonSize = {
  sm: 'h-7 px-2.5 text-small',
  md: 'h-8.5 px-3.5 text-body',
  lg: 'h-11 px-5 text-lead',
} as const;

export const primaryButtonClass = cn(
  buttonBase,
  'bg-phosphor text-ink hover:bg-phosphor-hi active:bg-phosphor-lo',
);

export const secondaryButtonClass = cn(
  buttonBase,
  'border border-line-strong bg-raised text-bone hover:border-line-hover hover:bg-raised-hover active:bg-raised-active',
);

export const ghostButtonClass = cn(
  buttonBase,
  'bg-transparent text-dust hover:bg-bone/6 hover:text-bone active:bg-bone/11',
);

export const liveButtonClass = cn(
  buttonBase,
  'bg-live text-ink-live hover:bg-live-hi active:bg-live-lo',
);

// Botón solo icono: 34 px, siempre con aria-label (y title para el tooltip).
export const iconButtonClass = cn(
  buttonBase,
  'size-8.5 bg-transparent text-dust hover:bg-bone/6 hover:text-bone active:bg-bone/11',
);

// Enlace de texto en Tube (información, "See all").
export const textLinkClass = cn(
  'rounded-xs text-small font-semibold text-tube hover:text-tube-hi hover:underline underline-offset-2',
  focusRing,
);

// Etiqueta de atajo de teclado.
export const kbdClass =
  'rounded-sm border border-line-strong bg-inset px-1.5 py-px font-sans text-micro font-medium text-dust';
