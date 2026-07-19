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

// Entrada escalonada de secciones (Stats global y por juego): fade + subida
// sutil, con ~70ms entre cada una según su `order`. fill-mode backwards para
// que el delay no enseñe la card "ya llegada" antes de arrancar su
// animación. Remontar el contenedor (key por juego/año) la vuelve a lanzar.
export const revealClass = 'animate-in fade-in-0 slide-in-from-bottom-3 duration-500';
export const revealStyle = (order: number): CSSProperties => ({
  animationDelay: `${order * 70}ms`,
  animationFillMode: 'backwards',
});
