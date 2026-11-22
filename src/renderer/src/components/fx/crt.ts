import { useLayoutEffect, useRef } from 'react';
import { EASE, prefersReducedMotion } from './motion';

// La lógica de CrtReveal (ver CrtReveal.tsx para el uso): fuera del .tsx para
// que el fast refresh de React siga funcionando con el componente.

export type CrtVariant = 'panel' | 'power-on' | 'screen';

type Spec = { frames: Keyframe[]; duration: number; easing: string };

const SPECS: Record<CrtVariant, Spec> = {
  panel: {
    frames: [
      { opacity: 0.4, transform: 'scaleY(0.02)', filter: 'brightness(2.2)' },
      { offset: 0.55, opacity: 1, filter: 'brightness(1.45)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    duration: 300,
    easing: EASE.out,
  },
  'power-on': {
    frames: [
      { offset: 0, opacity: 0, transform: 'scale(0.5, 0.02)', filter: 'brightness(3)' },
      { offset: 0.28, opacity: 1, transform: 'scale(1, 0.02)', filter: 'brightness(3)' },
      { offset: 0.55, transform: 'none', filter: 'brightness(1.6)' },
      { offset: 0.68, opacity: 0.72 },
      { offset: 0.78, opacity: 1, filter: 'brightness(1.25)' },
      { offset: 1, opacity: 1, transform: 'none', filter: 'none' },
    ],
    duration: 760,
    easing: EASE.out,
  },
  screen: {
    frames: [
      { opacity: 0.55, filter: 'brightness(1.5)' },
      { opacity: 1, filter: 'none' },
    ],
    duration: 240,
    easing: EASE.out,
  },
};

const REDUCED: Spec = {
  frames: [{ opacity: 0 }, { opacity: 1 }],
  duration: 180,
  easing: 'ease-out',
};

// Dispara la animación sobre un nodo cualquiera. Devuelve la Animation para
// poder cancelarla (o null si el entorno no tiene WAAPI).
export const playCrt = (
  element: HTMLElement,
  variant: CrtVariant = 'panel',
  delayMs = 0,
): Animation | null => {
  if (typeof element.animate !== 'function') return null;
  const spec = prefersReducedMotion() ? REDUCED : SPECS[variant];
  return element.animate(spec.frames, {
    duration: spec.duration,
    easing: spec.easing,
    delay: delayMs,
    fill: 'backwards',
  });
};

// Hook: anima el nodo de la ref al montar y cada vez que cambia `replayKey`.
export const useCrtReveal = <T extends HTMLElement>(
  variant: CrtVariant = 'panel',
  replayKey?: unknown,
  delayMs = 0,
): React.RefObject<T | null> => {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const animation = playCrt(element, variant, delayMs);
    return () => animation?.cancel();
  }, [variant, replayKey, delayMs]);
  return ref;
};
