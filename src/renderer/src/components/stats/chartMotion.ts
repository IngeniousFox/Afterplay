import type { CSSProperties } from 'react';

// Piezas de movimiento compartidas por las gráficas de Stats, encima de
// components/fx/chart (useInView + chartGroup + growY/drawLine/spinIn).

// La cifra encima de una barra (el pico o la que estás mirando). Va FUERA del
// relleno escalado, para que no se aplaste mientras la barra crece: la
// columna lleva --bar-height y la cifra se apoya justo encima.
//   · La primera vez que la gráfica entra en vista aparece con un fundido
//     cuando su barra ya ha crecido (barValueStyle da el retraso).
//   · Después, cada cifra nueva (al pasar el ratón) sale con un pop-in.
// El pop va con fill `backwards` (no `both`): una animación con fill final
// pisaría para siempre la opacidad que gobierna la entrada.
// Reduced motion: sin pop ni fundido retrasado.
export const barValueClass =
  'pointer-events-none absolute bottom-[calc(var(--bar-height)+6px)] left-1/2 -translate-x-1/2 origin-bottom animate-[pop-in_150ms_var(--ease-out)_backwards] opacity-0 transition-opacity duration-200 group-data-inview/chart:opacity-100 motion-reduce:animate-none motion-reduce:transition-none';

export const barValueStyle = (index: number, step: number): CSSProperties => ({
  transitionDelay: `${index * step + 480}ms`,
});

// Los bocadillos de las gráficas salen con un pop-in desde su ancla. Su
// posición va con la propiedad `translate` (no `transform`), que se compone
// con la escala del keyframe en vez de pisarla.
export const tooltipPopClass = 'animate-pop-in motion-reduce:animate-fade-in';

// Bloom para una marca SVG señalada (vértice, punto de una línea): el halo
// toma el color de texto (currentColor), así que ponle text-* o style.color.
export const markBloomClass =
  'transition-[filter] duration-150 [filter:drop-shadow(0_0_5px_currentColor)] motion-reduce:transition-none';
