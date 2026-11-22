import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// SLIDING INDICATOR: el subrayado (o la píldora) que se desliza de pestaña en
// pestaña con un muelle corto, en vez de saltar.
//
//   <nav ref={navRef} className="relative …">
//     {tabs…}                                    la activa con aria-current,
//     <SlidingIndicator                           aria-selected o data-active
//       containerRef={navRef}
//       activeKey={pathname}                      re-mide cuando cambia
//       className="bottom-0 h-0.5 rounded-full bg-phosphor shadow-glow-bar"
//       inset={12}                                recorte a cada lado (px)
//     />
//   </nav>
//   Píldora: className="inset-y-1 rounded-sm bg-raised -z-10" sin `inset`.
//
//   Vertical (un índice lateral, como el de Ajustes): axis="y". Entonces se
//   mueve con translateY + scaleY y `inset` recorta arriba y abajo; el ancho
//   y la posición horizontal los pones tú (className="inset-x-0 …").
//
// Se mueve con transform (translateX + scaleX sobre una barra de 100 px, o
// translateY + scaleY en vertical), nada de animar left ni width; es una transición, así que si cambias de pestaña a
// media carrera sale desde donde está. La primera colocación no anima. Sin
// pestaña activa (otra sección) se funde. Se re-mide si el contenedor cambia
// de tamaño (ResizeObserver). Reduced motion: salta sin deslizarse.
//
// Es aria-hidden: la pestaña activa ya se anuncia por su atributo.

const ACTIVE_SELECTOR = '[aria-current="page"], [aria-selected="true"], [data-active="true"]';
const BASE = 100;

// `shown` false conserva la última posición: se funde donde estaba. `offset`
// y `size` van sobre el eje del indicador (x/ancho u y/alto).
type Box = { offset: number; size: number; shown: boolean } | null;

export const SlidingIndicator = ({
  containerRef,
  activeKey,
  selector = ACTIVE_SELECTOR,
  inset = 0,
  axis = 'x',
  className,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeKey: unknown;
  selector?: string;
  inset?: number;
  axis?: 'x' | 'y';
  className?: string;
}): React.JSX.Element => {
  const [box, setBox] = useState<Box>(null);
  // La primera vez se coloca sin transición; luego ya desliza.
  const [ready, setReady] = useState(false);
  const placedOnce = useRef(false);

  useLayoutEffect(() => {
    // Si el indicador va DENTRO del contenedor (lo normal), en el montaje su
    // efecto corre antes de que React cuelgue la ref del padre: React adjunta
    // la ref de un nodo después de los efectos de sus hijos. Sin este
    // reintento al frame siguiente, la primera colocación se perdía y el
    // indicador no aparecía hasta el primer cambio de pestaña (que, además,
    // ya no deslizaba: era su "primera" colocación).
    let observer: ResizeObserver | null = null;
    let raf = 0;
    const attach = (container: HTMLElement): void => {
      measureIn(container);
      observer = new ResizeObserver(() => measureIn(container));
      observer.observe(container);
    };
    const measureIn = (container: HTMLElement): void => {
      const active = container.querySelector<HTMLElement>(selector);
      if (!active) {
        setBox((last) => (last ? { ...last, shown: false } : null));
        return;
      }
      const outer = container.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      setBox(
        axis === 'x'
          ? {
              offset: rect.left - outer.left + inset,
              size: Math.max(0, rect.width - inset * 2),
              shown: true,
            }
          : {
              offset: rect.top - outer.top + inset,
              size: Math.max(0, rect.height - inset * 2),
              shown: true,
            },
      );
    };
    if (containerRef.current) attach(containerRef.current);
    else
      raf = requestAnimationFrame(() => {
        if (containerRef.current) attach(containerRef.current);
      });
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [containerRef, activeKey, selector, inset, axis]);

  useLayoutEffect(() => {
    if (box && !placedOnce.current) {
      placedOnce.current = true;
      // Un frame después: el primer pintado ya está en su sitio.
      const raf = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [box]);

  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute block',
        axis === 'x' ? 'left-0 origin-left' : 'top-0 origin-top',
        ready &&
          'transition-[transform,scale,opacity] duration-420 ease-spring-soft motion-reduce:transition-none',
        box?.shown ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={
        axis === 'x'
          ? {
              width: BASE,
              transform: box ? `translateX(${box.offset}px) scaleX(${box.size / BASE})` : undefined,
            }
          : {
              height: BASE,
              transform: box ? `translateY(${box.offset}px) scaleY(${box.size / BASE})` : undefined,
            }
      }
    />
  );
};
