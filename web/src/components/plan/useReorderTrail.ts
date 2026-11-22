import { useLayoutEffect, useRef } from 'react';
import { EASE, prefersReducedMotion } from '../fx/motion';

// LA ESTELA AL REORDENAR el Up next. Reordenar no es optimista: la lista
// cambia cuando vuelve el servidor, y la fila saltaba de sitio de golpe. Esto
// la hace viajar (FLIP): al cambiar su puesto se mide dónde estaba y dónde
// está, y se anima desde el sitio viejo hasta el nuevo con un muelle corto
// (transform). La fila que TÚ moviste deja además una estela de fósforo hacia
// el lado del que viene: una capa con degradado que se estira y se apaga
// (transform y opacidad).
//
// Solo en modo reordenar (`active`): fuera de él, una fila que cambia de
// puesto (otra búsqueda, un pin) aparece sin viaje. Reduced motion: sin
// viaje; la estela queda como un destello que se apaga.
export const useReorderTrail = (
  position: number | undefined,
  active: boolean,
  moved: boolean,
): {
  rowRef: React.RefObject<HTMLLIElement | null>;
  trailRef: React.RefObject<HTMLSpanElement | null>;
} => {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const trailRef = useRef<HTMLSpanElement | null>(null);
  const lastTop = useRef<number | null>(null);

  // Primero se compara con la medida del render anterior…
  useLayoutEffect(() => {
    const row = rowRef.current;
    const previous = lastTop.current;
    if (!active || !row || previous === null || typeof row.animate !== 'function') return;
    const delta = previous - row.offsetTop;
    if (Math.abs(delta) < 2) return;
    const reduced = prefersReducedMotion();
    if (!reduced) {
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
        duration: 420,
        easing: EASE.springSoft,
      });
    }
    const trail = trailRef.current;
    if (moved && trail) {
      // La estela apunta al sitio del que viene (delta > 0: estaba más
      // abajo y ha subido) y mide lo que ha viajado; se encoge hacia la fila
      // y se apaga.
      const fromBelow = delta > 0;
      Object.assign(trail.style, {
        height: `${Math.abs(delta)}px`,
        top: fromBelow ? '100%' : 'auto',
        bottom: fromBelow ? 'auto' : '100%',
        transformOrigin: fromBelow ? 'top' : 'bottom',
        backgroundImage: `linear-gradient(${fromBelow ? 'to bottom' : 'to top'}, rgb(255 179 71 / 0.34), rgb(255 179 71 / 0.08) 60%, transparent)`,
      });
      trail.animate(
        reduced
          ? [{ opacity: 0.7 }, { opacity: 0 }]
          : [
              { opacity: 0.9, transform: 'scaleY(1)' },
              { offset: 0.35, opacity: 0.7, transform: 'scaleY(0.6)' },
              { opacity: 0, transform: 'scaleY(0)' },
            ],
        { duration: reduced ? 300 : 520, easing: EASE.out, fill: 'backwards' },
      );
    }
  }, [position, active, moved]);

  // …y después se guarda la de este, para el siguiente. Sin deps: cada render.
  useLayoutEffect(() => {
    lastTop.current = rowRef.current?.offsetTop ?? null;
  });

  return { rowRef, trailRef };
};
