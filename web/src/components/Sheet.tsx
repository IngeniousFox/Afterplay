import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

// Hoja inferior: sube desde abajo sobre un velo, con el asa arriba y el título
// en Big Shoulders. Se cierra con el velo, con Escape o desde dentro. Con
// movimiento reducido no se desliza, solo aparece (fosforo.css anula --np-y).
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative mx-auto max-h-[90dvh] w-full max-w-lg animate-np-in overflow-y-auto rounded-t-md border-t border-line-strong bg-overlay px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-modal outline-none"
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
    </div>,
    document.body,
  );
};
