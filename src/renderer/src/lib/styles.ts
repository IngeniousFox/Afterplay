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
// Fondo hex sólido (#171918 = rgb(23,25,24) a opacidad plena) y no
// rgba(...,.99): ese 1% de translucidez se colaba sobre el contenido claro
// de detrás (la ficha, con hero/capturas) y el panel se veía semitranslúcido
// — un panel flotante tiene que tapar, no dejar ver lo que hay debajo.
export const floatingPanelClass = 'border-input bg-[#171918] shadow-[0_18px_50px_rgba(0,0,0,.55)]';

// Botón "outline" secundario (Open game / All games / All sessions) —
// idéntico byte a byte en Sessions.tsx y GameStats.tsx, cada uno le añade
// sus propias clases de color según el estado activo/inactivo.
export const outlineButtonClass =
  'flex items-center gap-1.75 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap';

// Botón cuadrado de icono (cambiar carátula, editar notas...) — idéntico
// byte a byte entre ActionBar (ficha normal) y PlanGameDetail (ficha de
// Plan to Play).
export const squareIconButtonClass =
  'flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-input bg-white/[0.03] hover:bg-white/[0.06]';

// Misma forma que squareIconButtonClass pero en rojo — el botón de borrar,
// en los mismos dos sitios.
export const destructiveIconButtonClass =
  'flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-destructive/40 bg-destructive/8 hover:bg-destructive/18';

// Botón grande de la cabecera del detalle (Play / Add to library) — mismo
// tamaño/forma en ActionBar y PlanGameDetail; el color sale de
// accentGradientStyle (o del estilo "en marcha" propio de ActionBar) por
// fuera, vía `style`. ActionBar es el único de los dos con estado
// deshabilitado — añade sus propias clases disabled: encima de esta.
export const heroCtaButtonClass =
  'flex items-center gap-2.25 rounded-[11px] px-7.5 py-3 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.28)]';

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
export const notesProseClass =
  'afterplay-notes prose prose-invert prose-sm max-w-none ' +
  'prose-hr:border-border prose-hr:my-[12px] ' +
  'prose-h1:text-[23px] prose-h1:leading-[1.3] prose-h1:font-bold prose-h1:mt-0 prose-h1:mb-[6px] ' +
  'prose-h2:mt-[12px] prose-h2:mb-[6px] prose-h3:mt-[12px] prose-h3:mb-[6px] ' +
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

// Aparición de un panel condicional DENTRO de una sección ya visible — al
// marcar un checkbox, cambiar una opción, expandir un desplegable. Más corta
// y con menos desplazamiento que revealClass (pensada para secciones
// enteras entrando de golpe al abrir); esta es para que un bloque que ya
// vivía ahí deje de aparecer de golpe.
export const expandClass = 'animate-in fade-in-0 slide-in-from-top-2 duration-250';
