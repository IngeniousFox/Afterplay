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
// Se mueve con transform (translateX + scaleX sobre una barra de 100 px), nada
// de animar left ni width; es una transición, así que si cambias de pestaña a
// media carrera sale desde donde está. La primera colocación no anima. Sin
// pestaña activa (otra sección) se funde. Se re-mide si el contenedor cambia
// de tamaño (ResizeObserver). Reduced motion: salta sin deslizarse.
//
// Es aria-hidden: la pestaña activa ya se anuncia por su atributo.

const ACTIVE_SELECTOR = '[aria-current="page"], [aria-selected="true"], [data-active="true"]';
const BASE = 100;

// `shown` false conserva la última posición: se funde donde estaba.
type Box = { x: number; width: number; shown: boolean } | null;

export const SlidingIndicator = ({
  containerRef,
  activeKey,
  selector = ACTIVE_SELECTOR,
  inset = 0,
  className,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeKey: unknown;
  selector?: string;
  inset?: number;
  className?: string;
}): React.JSX.Element => {
  const [box, setBox] = useState<Box>(null);
  // La primera vez se coloca sin transición; luego ya desliza.
  const [ready, setReady] = useState(false);
  const placedOnce = useRef(false);

  // Re-run once after mount: when the indicator mounts together with its
  // container, this child effect runs before React attaches the parent's ref.
  const [retry, setRetry] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      if (retry > 0) return undefined;
      const raf = requestAnimationFrame(() => setRetry(1));
      return () => cancelAnimationFrame(raf);
    }
    const measure = (): void => {
      const active = container.querySelector<HTMLElement>(selector);
      if (!active) {
        setBox((last) => (last ? { ...last, shown: false } : null));
        return;
      }
      const outer = container.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      setBox({
        x: rect.left - outer.left + inset,
        width: Math.max(0, rect.width - inset * 2),
        shown: true,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, activeKey, selector, inset, retry]);

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
        'pointer-events-none absolute left-0 block origin-left',
        ready &&
          'transition-[transform,scale,opacity] duration-420 ease-spring-soft motion-reduce:transition-none',
        box?.shown ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{
        width: BASE,
        transform: box ? `translateX(${box.x}px) scaleX(${box.width / BASE})` : undefined,
      }}
    />
  );
};
