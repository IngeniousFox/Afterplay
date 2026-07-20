import type { CSSProperties } from 'react';

// Estilo del degradado verde de acento — el mismo objeto que hoy se repite
// (inline, `style={{...}}`) en botones "submit" de modales, popovers y
// tarjetas de toda la app. Un solo sitio para no divergir el verde/negro por
// accidente en algún punto suelto.
export const accentGradientStyle = {
  background: 'linear-gradient(135deg,#2fdc7e,#16a35a)',
  color: '#08120c',
} as const;

// Clase compartida por los paneles flotantes (dropdowns, popovers, tooltips)
// que hoy repiten el mismo trío borde/fondo/sombra — cada sitio conserva el
// resto de sus propias clases (ancho, padding, overflow…), solo este trío
// sale de aquí.
export const floatingPanelClass =
  'border-input bg-[rgba(23,25,24,.99)] shadow-[0_18px_50px_rgba(0,0,0,.55)]';

// Botón "outline" secundario (Open game / All games / All sessions) —
// idéntico byte a byte en Sessions.tsx y GameStats.tsx, cada uno le añade
// sus propias clases de color según el estado activo/inactivo.
export const outlineButtonClass =
  'flex items-center gap-1.75 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap';

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
// `afterplay-notes` es solo un gancho para el CSS: el <hr> de prose trae un
// color azulado propio (--tw-prose-invert-hr) y se reemplaza por el borde
// neutro de la app en main.css (`.afterplay-notes hr`) — vía clase y no
// variante Tailwind arbitraria porque esta última no siempre compila dentro
// de una cadena concatenada.
export const notesProseClass =
  'afterplay-notes prose prose-invert prose-sm max-w-none ' +
  '[&_:not(pre)>code::before]:content-none [&_:not(pre)>code::after]:content-none ' +
  '[&_:not(pre)>code]:rounded-[5px] [&_:not(pre)>code]:bg-white/[0.07] ' +
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
