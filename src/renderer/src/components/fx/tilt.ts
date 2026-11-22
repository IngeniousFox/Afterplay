import { useCallback } from 'react';
import { canHover, prefersReducedMotion } from './motion';

// La delegación de TiltCover (ver TiltCover.tsx para el uso).

const MAX_DEG = 8;

// La delegación. Devuelve una ref-callback para el contenedor.
export const useTiltRegion = (): ((node: HTMLElement | null) => (() => void) | undefined) =>
  useCallback((node: HTMLElement | null) => {
    if (!node) return undefined;
    let current: HTMLElement | null = null;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const release = (): void => {
      if (!current) return;
      current.removeAttribute('data-tilting');
      current.style.removeProperty('--tilt-rx');
      current.style.removeProperty('--tilt-ry');
      current = null;
    };

    const frame = (): void => {
      raf = 0;
      if (!current) return;
      // Una sola lectura de geometría por frame, y solo de la portada activa.
      const rect = current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = Math.min(1, Math.max(0, (lastX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (lastY - rect.top) / rect.height));
      current.style.setProperty('--tilt-ry', `${((px - 0.5) * 2 * MAX_DEG).toFixed(2)}deg`);
      current.style.setProperty('--tilt-rx', `${((0.5 - py) * 2 * MAX_DEG).toFixed(2)}deg`);
      current.style.setProperty('--glare-x', `${(px * 100).toFixed(1)}%`);
      current.style.setProperty('--glare-y', `${(py * 100).toFixed(1)}%`);
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null;
      if (target !== current) {
        release();
        if (target && node.contains(target) && canHover() && !prefersReducedMotion()) {
          current = target;
          current.setAttribute('data-tilting', '');
        }
      }
      if (!current) return;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    // Al hacer scroll la portada se va de debajo del ratón sin pointermove.
    const onLeave = (): void => release();

    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave);
    node.addEventListener('scroll', onLeave, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      release();
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('scroll', onLeave, { capture: true });
    };
  }, []);
