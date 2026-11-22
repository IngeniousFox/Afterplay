import { useCallback, useState } from 'react';
import { createViewportPool } from '../../lib/intersectionPool';

// GRÁFICAS QUE ENTRAN: las barras crecen desde la base, las líneas se dibujan
// y las donuts giran, la primera vez que la gráfica entra en pantalla.
//
//   const { observe, inView } = useInView();
//   <div ref={observe} data-inview={inView || undefined} className={chartGroup}>
//     <span className={growY} style={{ animationDelay: `${i * 40}ms` }} />   barra vertical
//     <span className={growX} />                                         barra horizontal
//     <path pathLength={1} className={drawLine} />                       línea SVG
//     <g className={spinIn}>…donut…</g>
//   </div>
//
// Cómo funciona: la animación CSS está montada desde el principio pero en
// pausa (en su primer fotograma) y arranca cuando el contenedor lleva
// data-inview. Así no hay un fotograma con la gráfica entera antes de
// encogerse. Una sola vez: no se repite al volver a pasar por ella.
//
// Reduced motion: sin animación; la gráfica está entera desde el principio
// (motion-reduce:animate-none). Ese es también el estado en reposo.
// Un IntersectionObserver compartido por scroller (lib/intersectionPool).

const pool = createViewportPool(0);

export const useInView = (): {
  observe: (node: HTMLElement | SVGElement | null) => (() => void) | undefined;
  inView: boolean;
} => {
  const [inView, setInView] = useState(false);
  const observe = useCallback((node: HTMLElement | SVGElement | null) => {
    if (!node) return undefined;
    let unobserve: (() => void) | null = null;
    unobserve = pool.observe(node, (intersecting) => {
      if (!intersecting) return;
      setInView(true);
      // Una vez dentro, ya no hace falta mirar.
      unobserve?.();
      unobserve = null;
    });
    return () => unobserve?.();
  }, []);
  return { observe, inView };
};

// El grupo que leen las clases de abajo.
export const chartGroup = 'group/chart';

// La pausa hasta entrar en vista, suelta, para animaciones propias de una
// gráfica (un barrido, un fundido, una expansión): `animate-[…] ${chartPaused}`.
// Lleva motion-reduce:animate-none, así que solo vale para entradas cuyo
// estado final es el de reposo.
export const chartPaused =
  '[animation-play-state:paused] group-data-inview/chart:[animation-play-state:running] motion-reduce:animate-none';
const paused = chartPaused;

export const growY = `origin-bottom animate-grow-y ${paused}`;
export const growX = `origin-left animate-grow-x ${paused}`;
// La línea necesita pathLength={1}: el trazo va de 1 (oculto) a 0 (entero).
export const drawLine = `[stroke-dasharray:1] animate-draw ${paused}`;
export const spinIn = `origin-center [transform-box:fill-box] animate-spin-in ${paused}`;
