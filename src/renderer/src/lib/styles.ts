import type { CSSProperties } from 'react';

// Acento de Fósforo para los botones primarios que se pintan con `style`
// (submit de modales, popovers y tarjetas): Phosphor sólido con tinta oscura.
// El nombre se queda por los consumidores; ya no es un degradado. Si se puede
// usar clase, mejor primaryButtonClass (trae hover/active/foco).
export const accentGradientStyle = {
  background: 'var(--color-phosphor)',
  color: 'var(--color-ink)',
} as const;

// Foco y pulsación comunes a todos los controles de Fósforo: outline de 2 px
// Phosphor con 2 px de separación y scale(.97) al pulsar.
const controlFocusPressClass =
  'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor active:scale-[.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100';

// Botones de Fósforo (hoja 4) para los sitios que no usan components/ui/button:
// primario ámbar (uno por vista), secundario Raised + Line strong y peligro
// Live sólido con tinta oscura.
export const primaryButtonClass = `flex items-center justify-center gap-2 rounded-sm bg-phosphor px-5 py-2.5 text-[13.5px] font-semibold text-ink transition-[background-color,transform] duration-150 enabled:hover:bg-phosphor-hi enabled:active:bg-phosphor-lo ${controlFocusPressClass}`;
export const secondaryButtonClass = `flex items-center justify-center gap-2 rounded-sm border border-line-strong bg-raised px-4.5 py-2.5 text-[13.5px] font-semibold text-bone transition-[background-color,border-color,transform] duration-150 enabled:hover:border-line-hover enabled:hover:bg-raised-hover enabled:active:bg-raised-active ${controlFocusPressClass}`;
export const dangerButtonClass = `flex items-center justify-center gap-2 rounded-sm bg-live px-5 py-2.5 text-[13.5px] font-semibold text-ink-live transition-[background-color,transform] duration-150 enabled:hover:bg-live-hi enabled:active:bg-live-lo ${controlFocusPressClass}`;

// Clase compartida por los paneles flotantes (dropdowns, popovers, tooltips)
// que hoy repiten el mismo trío borde/fondo/sombra — cada sitio conserva el
// resto de sus propias clases (ancho, padding, overflow…), solo este trío
// sale de aquí. Fósforo: Overlay opaco (un panel flotante tiene que tapar)
// con Line strong y shadow-float, que ya trae el filo superior.
export const floatingPanelClass = 'border-line-strong bg-overlay shadow-float';

// Botón "outline" secundario (Open game / All games / All sessions) —
// idéntico byte a byte en Sessions.tsx y GameStats.tsx, cada uno le añade
// sus propias clases de color según el estado activo/inactivo.
export const outlineButtonClass = `flex items-center gap-1.75 rounded-sm border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ${controlFocusPressClass}`;

// Botón cuadrado de icono (cambiar carátula, editar notas...) — idéntico
// byte a byte entre ActionBar (ficha normal) y PlanGameDetail (ficha de
// Plan to Play). Fósforo: secundario de 44 px.
export const squareIconButtonClass = `flex h-11 w-11 flex-none items-center justify-center rounded-sm border border-line-strong bg-raised text-bone transition-[background-color,border-color,transform] duration-150 hover:border-line-hover hover:bg-raised-hover active:bg-raised-active ${controlFocusPressClass}`;

// Misma forma que squareIconButtonClass pero en Live — el botón de borrar,
// en los mismos dos sitios. Fantasma en Live (no sólido): es un icono junto a
// otros y el sólido se reserva para la confirmación.
export const destructiveIconButtonClass = `flex h-11 w-11 flex-none items-center justify-center rounded-sm border border-live/40 bg-live/8 text-live transition-[background-color,border-color,transform] duration-150 hover:border-live/60 hover:bg-live/16 ${controlFocusPressClass}`;

// Botón grande de la cabecera del detalle (Play / Add to library) — mismo
// tamaño/forma en ActionBar y PlanGameDetail; el color sale de
// accentGradientStyle (o del estilo "en marcha" propio de ActionBar) por
// fuera, vía `style`. ActionBar es el único de los dos con estado
// deshabilitado — añade sus propias clases disabled: encima de esta.
export const heroCtaButtonClass = `flex h-11 items-center gap-2.25 rounded-sm px-7 text-[15px] font-semibold transition-[background-color,filter,transform] duration-150 hover:brightness-110 ${controlFocusPressClass}`;

// Prose de las notas — el MISMO en el editor (NotesEditor) y en la vista de
// lectura (NotesSection), para que escribir y leer se vean idénticos. Añade
// dos arreglos sobre el prose base:
//   1. quita los backticks decorativos que @tailwindcss/typography pone
//      alrededor del código inline (code::before/after: content '`'), que
//      parecían markdown sin renderizar;
//   2. pinta ese código inline como una "pastilla" (fondo + padding) para que
//      se distinga sin depender de los backticks. Ambos ajustes se limitan a
//      `:not(pre) > code` para no tocar los bloques de código (pre), que ya
//      tienen su propio fondo.
// Shared heading and divider utilities keep editor, reading view and TV notes identical.
// Fósforo: el cuerpo hereda Barlow (font-sans) y los colores del prose se
// atan a los tokens (Bone, Dust, Tube para enlaces, Phosphor para viñetas);
// los títulos van en Big Shoulders, como los del resto de la app.
export const notesProseClass =
  'afterplay-notes prose prose-invert prose-sm max-w-none font-sans ' +
  '[--tw-prose-invert-body:var(--color-bone)] [--tw-prose-invert-headings:var(--color-bone)] ' +
  '[--tw-prose-invert-bold:var(--color-bone)] [--tw-prose-invert-links:var(--color-tube)] ' +
  '[--tw-prose-invert-bullets:var(--color-phosphor)] [--tw-prose-invert-counters:var(--color-dust)] ' +
  '[--tw-prose-invert-quotes:var(--color-bone)] [--tw-prose-invert-quote-borders:var(--color-line-strong)] ' +
  '[--tw-prose-invert-code:var(--color-bone)] [--tw-prose-invert-hr:var(--color-line)] ' +
  'prose-headings:font-display prose-headings:font-bold prose-headings:tracking-[0.01em] ' +
  'prose-hr:border-line prose-hr:my-[12px] ' +
  'prose-h1:text-[26px] prose-h1:leading-[1.15] prose-h1:mt-0 prose-h1:mb-[6px] ' +
  'prose-h2:text-[21px] prose-h2:mt-[12px] prose-h2:mb-[6px] prose-h3:text-[17px] prose-h3:mt-[12px] prose-h3:mb-[6px] ' +
  '[&_:not(pre)>code::before]:content-none [&_:not(pre)>code::after]:content-none ' +
  '[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-inset ' +
  '[&_:not(pre)>code]:px-1.25 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-medium';

// Entrada escalonada de secciones (Stats global y por juego): fade + subida
// sutil, con ~70ms entre cada una según su `order`. fill-mode backwards para
// que el delay no enseñe la card "ya llegada" antes de arrancar su
// animación. Remontar el contenedor (key por juego/año) la vuelve a lanzar.
export const revealClass = 'animate-in fade-in-0 slide-in-from-bottom-3 duration-500';
export const revealStyle = (order: number): CSSProperties => ({
  animationDelay: `${order * 70}ms`,
  animationFillMode: 'backwards',
});

// Aparición de un panel condicional DENTRO de una sección ya visible — al
// marcar un checkbox, cambiar una opción, expandir un desplegable. Más corta
// y con menos desplazamiento que revealClass (pensada para secciones
// enteras entrando de golpe al abrir); esta es para que un bloque que ya
// vivía ahí deje de aparecer de golpe.
export const expandClass = 'animate-in fade-in-0 slide-in-from-top-2 duration-250';
