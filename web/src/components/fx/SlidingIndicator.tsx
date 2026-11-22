import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

// SLIDING INDICATOR: la raya (o píldora) que se desliza de pestaña en pestaña
// con un muelle corto, en vez de saltar.
//
//   <nav ref={navRef} className="relative …">
//     {tabs…}                                 la activa con aria-current
//     <SlidingIndicator containerRef={navRef} activeKey={pathname}
//       className="top-0 h-0.5 bg-phosphor" inset={22} />
//   </nav>
//
// Se mueve con transform (translateX + scaleX sobre una barra de 100 px),
// nada de animar left ni width. Es una transición: si cambias de pestaña a
// media carrera sale desde donde está. La primera colocación no anima; sin
// pestaña activa se funde. Reduced motion: salta sin deslizarse.

const ACTIVE_SELECTOR = '[aria-current="page"], [aria-selected="true"], [data-active="true"]';
const BASE = 100;

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
  const [ready, setReady] = useState(false);
  const placedOnce = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
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
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, activeKey, selector, inset]);

  useLayoutEffect(() => {
    if (box && !placedOnce.current) {
      placedOnce.current = true;
      const raf = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [box]);

  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-0 block origin-left',
        ready &&
          'transition-[transform,opacity] duration-420 ease-spring-soft motion-reduce:transition-none',
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
