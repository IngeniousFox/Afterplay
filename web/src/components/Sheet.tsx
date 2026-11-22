import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EASE, prefersReducedMotion } from './fx/motion';

// Hoja inferior: sube desde abajo sobre un velo, con el asa arriba y el título
// en Big Shoulders. Se cierra con el velo, con Escape o desde dentro.
//
// Entra con MUELLE: sube, se pasa unos píxeles y se asienta (WAAPI, solo
// transform). El rebote levantaría la hoja y dejaría ver un hueco bajo su
// borde, así que una extensión del mismo color sigue por debajo de la
// pantalla (el ::after del envoltorio). No hay gesto de arrastrar para
// cerrarla, así que no se inventa: el velo, Escape y sus botones bastan. Con
// movimiento reducido no se desliza, solo aparece con un fundido.
//
// Va en un portal al <body>: dentro de un bloque con transform (las entradas
// animate-screen-in) un `fixed` se posiciona contra ese bloque y no contra la
// pantalla.
//
// Bloquea el scroll del <body> mientras está abierta, guardando el valor de
// antes en vez de suponer que era `visible`.
export const Sheet = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // El muelle de entrada, sobre el envoltorio (el panel de dentro hace
  // scroll y recortaría la extensión de abajo).
  const springRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = springRef.current;
    if (!element || typeof element.animate !== 'function') return undefined;
    const animation = prefersReducedMotion()
      ? element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE.out })
      : element.animate(
          [
            { transform: 'translateY(100%)', easing: EASE.drawer },
            { offset: 0.68, transform: 'translateY(-10px)', easing: 'ease-in-out' },
            { transform: 'none' },
          ],
          { duration: 500, fill: 'backwards' },
        );
    return () => animation.cancel();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-scrim"
      />
      <div
        ref={springRef}
        className="relative mx-auto w-full max-w-lg after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-overlay"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-md border-t border-line-strong bg-overlay px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-modal outline-hidden"
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-bone/20" />
          <h2
            id={titleId}
            className="mb-3 font-display text-[32px] leading-[34px] font-bold tracking-[0.005em] text-bone"
          >
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
