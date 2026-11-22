import { useLayoutEffect, useRef } from 'react';
import { EASE, prefersReducedMotion } from './motion';

// La lógica de CrtReveal (ver CrtReveal.tsx para el uso).
//
// La versión del escritorio sube el brillo con `filter: brightness()`. Aquí
// no: un filter sobre un panel entero es repintarlo cada frame en un móvil.
// El destello va aparte, en <CrtFlash>, como una capa que cambia de opacidad.

export type CrtVariant = 'panel' | 'screen';

type Spec = { frames: Keyframe[]; duration: number; easing: string };

const SPECS: Record<CrtVariant, Spec> = {
  // Una línea que se abre en vertical: paneles y tarjetas héroe.
  panel: {
    frames: [
      { opacity: 0.4, transform: 'scaleY(0.02)' },
      { offset: 0.55, opacity: 1 },
      { opacity: 1, transform: 'none' },
    ],
    duration: 320,
    easing: EASE.out,
  },
  // Cambio de pantalla: solo opacidad, sin geometría. Una pantalla tiene
  // hijos `fixed` (la barra de la ficha) que un transform descolocaría.
  screen: {
    frames: [{ opacity: 0.45 }, { opacity: 1 }],
    duration: 260,
    easing: EASE.out,
  },
};

const REDUCED: Spec = {
  frames: [{ opacity: 0 }, { opacity: 1 }],
  duration: 180,
  easing: 'ease-out',
};

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

// Anima el nodo de la ref al montar y cada vez que cambia `replayKey`.
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
