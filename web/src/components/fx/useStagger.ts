import { useLayoutEffect, useRef } from 'react';
import { EASE, prefersReducedMotion } from './motion';

// La lógica de Stagger (ver Stagger.tsx). La misma idea que el escritorio:
// solo se reparten los hijos QUE SE VEN, ordenados por posición; el resto
// aparece ya asentado. Su coste no depende de cuántos hijos haya.

export type StaggerVariant = 'rise' | 'pop';

const FRAMES: Record<StaggerVariant, Keyframe[]> = {
  rise: [
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'none' },
  ],
  pop: [
    { opacity: 0, transform: 'scale(0.96)' },
    { opacity: 1, transform: 'none' },
  ],
};

export type StaggerOptions = {
  variant?: StaggerVariant;
  step?: number;
  max?: number;
  duration?: number;
  replayKey?: unknown;
};

const NOT_DEALT = Symbol('not-dealt');

export const useStagger = <T extends HTMLElement>({
  variant = 'rise',
  step = 45,
  max = 8,
  duration = 280,
  replayKey = 0,
}: StaggerOptions = {}): React.RefObject<T | null> => {
  const ref = useRef<T | null>(null);
  const dealtKey = useRef<unknown>(NOT_DEALT);
  const running = useRef<Animation[]>([]);

  // Sin deps a propósito: los hijos pueden llegar en un render posterior (una
  // lista que carga). Cada render solo compara una clave.
  useLayoutEffect(() => {
    if (Object.is(dealtKey.current, replayKey)) return;
    const container = ref.current;
    if (!container || container.children.length === 0) return;
    if (typeof container.animate !== 'function') return;
    dealtKey.current = replayKey;

    for (const animation of running.current) animation.cancel();

    const height = window.innerHeight;
    const visible = [...container.children]
      .map((element) => ({
        element: element as HTMLElement,
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < height)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const reduced = prefersReducedMotion();
    const frames = reduced ? [{ opacity: 0 }, { opacity: 1 }] : FRAMES[variant];
    running.current = visible.map(({ element }, order) =>
      element.animate(frames, {
        duration: reduced ? 160 : duration,
        delay: Math.min(order, max) * (reduced ? step / 2 : step),
        easing: EASE.out,
        fill: 'backwards',
      }),
    );
  });

  return ref;
};
