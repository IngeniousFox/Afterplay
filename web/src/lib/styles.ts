import type { CSSProperties } from 'react';
import type { StateType } from '../api';
import { cn } from './cn';

// Las clases que se repiten por toda la PWA (Fósforo, README-sistema.md):
// pulsar = scale(.97), foco = contorno Phosphor de 2 px, disabled = 40 %.
// Todas literales para que Tailwind las encuentre.

const pressable = cn(
  'transition-[transform,scale,background-color,border-color,color] duration-150 ease-out',
  'active:scale-[.97] motion-reduce:active:scale-100',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
);

const button = cn(
  pressable,
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-body font-semibold',
);

export const primaryButtonClass = cn(
  button,
  'bg-phosphor text-ink hover:bg-phosphor-hi active:bg-phosphor-lo',
);

export const secondaryButtonClass = cn(
  button,
  'border border-line-strong bg-raised text-bone hover:border-line-hover hover:bg-raised-hover active:bg-raised-active',
);

export const ghostButtonClass = cn(
  button,
  'text-dust hover:bg-bone/6 hover:text-bone active:bg-bone/11',
);

export const dangerButtonClass = cn(
  button,
  'bg-live text-ink-live hover:bg-live-hi active:bg-live-lo',
);

// Botón de solo icono: 44 × 44 de diana aunque el dibujo sea pequeño.
export const iconButtonClass = cn(
  pressable,
  'inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-dust hover:bg-bone/6 hover:text-bone',
);

// Campos de texto. 16 px de letra: con menos, Safari de iOS amplía la página
// al enfocar el campo.
export const fieldClass = cn(
  'min-h-11 w-full rounded-sm border border-edge bg-inset px-3 text-[16px] text-bone outline-hidden',
  'transition-[border-color,box-shadow] duration-150 placeholder:text-dust',
  'focus:border-phosphor focus:shadow-focus-field',
);

// Fila pulsable de lista (Library, Sessions, Plan…).
export const rowLinkClass = cn(
  'flex min-h-14 items-center gap-3 py-2.5',
  'transition-colors duration-150 active:bg-bone/6',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
);

// El LED de estado: uno de los cinco tonos de Fósforo. On Hold comparte el de
// Resting, y Unplayed / Plan to play el de Backlog (src/shared/gameStatus.ts).
const LED_CLASS: Record<StateType, string> = {
  started: 'bg-st-playing',
  completed: 'bg-st-beaten',
  dropped: 'bg-st-dropped',
  on_hold: 'bg-st-resting',
  resting: 'bg-st-resting',
  plan_to_play: 'bg-st-backlog',
};

const STATUS_TEXT_CLASS: Record<StateType, string> = {
  started: 'text-st-playing',
  completed: 'text-st-beaten',
  dropped: 'text-st-dropped',
  on_hold: 'text-st-resting',
  resting: 'text-st-resting',
  plan_to_play: 'text-st-backlog',
};

export const ledClass = (state: StateType | null): string =>
  state === null ? 'bg-st-backlog' : LED_CLASS[state];

export const statusTextClass = (state: StateType | null): string =>
  state === null ? 'text-st-backlog' : STATUS_TEXT_CLASS[state];

// Entrada escalonada de bloques: sube y aparece (con movimiento reducido, solo
// el fundido; lo resuelve fosforo.css).
export const revealClass = 'animate-screen-in';
export const revealDelay = (order: number, step = 40, cap = 12): CSSProperties => ({
  animationDelay: `${Math.min(order, cap) * step}ms`,
});
