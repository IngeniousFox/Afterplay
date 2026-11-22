// MEDIDORES QUE SE RELLENAN al entrar en la vista: las barras crecen desde su
// base (scaleX / scaleY, keyframes grow-x y grow-y de fosforo.css).
//
//   const { observe, inView } = useInView();
//   <div ref={observe} data-inview={inView || undefined} className={chartGroup}>
//     <span className={growX} style={{ animationDelay: `${i * 40}ms` }} />
//   </div>
//
// La animación está montada desde el principio pero en pausa (en su primer
// fotograma) y arranca cuando el contenedor lleva data-inview: no hay un
// fotograma con el medidor entero antes de vaciarse. Una sola vez.
// Reduced motion: sin animación, el medidor entero desde el principio.

export const chartGroup = 'group/chart';

const paused =
  '[animation-play-state:paused] group-data-inview/chart:[animation-play-state:running] motion-reduce:animate-none';

export const growX = `origin-left animate-grow-x ${paused}`;
export const growY = `origin-bottom animate-grow-y ${paused}`;
// Un encendido sin geometría (segmentos que «se encienden» uno a uno).
export const lightUp = `animate-fade-in ${paused}`;
