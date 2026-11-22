import { useSyncExternalStore } from 'react';

// LA BASE DE components/fx: curvas, consultas de medios y la regla de oro.
//
// Todas las primitivas de esta carpeta cumplen dos cosas:
//   1. Reduced motion: sin movimiento, sin escala, sin bucles decorativos y
//      sin conteo; se quedan los fundidos y el color.
//   2. Estado en reposo completo: lo que se ve cuando la animación termina
//      (o si nunca llega a correr) es la interfaz entera. Nada se queda en
//      opacity 0 esperando a un JavaScript que quizá no llega: las animaciones
//      de WAAPI van con fill 'backwards' y las de CSS acaban en `none`.

// Las mismas curvas que fosforo.css (--ease-*), para WAAPI.
export const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  springSoft: 'cubic-bezier(0.3, 1.3, 0.5, 1)',
} as const;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

const media = (query: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

// Lectura puntual, para el momento de disparar una animación (WAAPI, chispas).
export const prefersReducedMotion = (): boolean => media(REDUCED_QUERY)?.matches ?? false;

// Ratón de verdad: el tilt y los hover con movimiento no tienen sentido al
// tocar una pantalla (el "hover" del tacto es un falso positivo).
export const canHover = (): boolean => media(HOVER_QUERY)?.matches ?? false;

const subscribeReduced = (onChange: () => void): (() => void) => {
  const list = media(REDUCED_QUERY);
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
};

// La versión reactiva, para lo que se decide al pintar (Ticker, VuMeter).
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
