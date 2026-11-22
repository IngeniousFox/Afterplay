import { useSyncExternalStore } from 'react';

// LA BASE DE components/fx DE LA PWA: las versiones ligeras de las primitivas
// del escritorio (src/renderer/src/components/fx), pensadas para un móvil.
//
// Tres reglas que cumplen todas:
//   1. Solo transform y opacity. Nada de filter, text-shadow animado ni
//      background-position en bucle: en un móvil eso es repintar cada frame.
//      Los brillos son capas con degradado que cambian de OPACIDAD.
//   2. Reduced motion: sin movimiento, sin escala, sin bucles y sin conteo; se
//      quedan los fundidos y el color.
//   3. Estado en reposo completo: lo que se ve sin animación es la interfaz
//      entera. WAAPI con fill 'backwards' y CSS que acaba en `none`.
//
// Los bucles CSS (VuMeter, haz, grano, respiración) leen --fx-play, que
// installFxVisibility pone a `paused` con la pestaña oculta. Así un bucle no
// sigue corriendo con el móvil bloqueado y la PWA en segundo plano.

// Las mismas curvas que fosforo.css (--ease-*), para WAAPI.
export const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  springSoft: 'cubic-bezier(0.3, 1.3, 0.5, 1)',
} as const;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const media = (query: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

// Lectura puntual, para el momento de disparar una animación.
export const prefersReducedMotion = (): boolean => media(REDUCED_QUERY)?.matches ?? false;

const subscribeReduced = (onChange: () => void): (() => void) => {
  const list = media(REDUCED_QUERY);
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
};

// La versión reactiva, para lo que se decide al pintar (Ticker).
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);

// La clase que pausa un bucle CSS con la pestaña oculta. Va en cada bucle
// junto a su animate-*; un style inline `animationPlayState` (fuera de la
// vista) la sustituye.
export const loopPlayClass = '[animation-play-state:var(--fx-play,running)]';

// Una sola escucha para toda la app (main.tsx). Cambiar una variable en la
// raíz recalcula estilos, pero solo pasa al ocultar o enseñar la pestaña.
export const installFxVisibility = (): (() => void) => {
  const root = document.documentElement;
  const apply = (): void => {
    root.style.setProperty('--fx-play', document.hidden ? 'paused' : 'running');
  };
  apply();
  document.addEventListener('visibilitychange', apply);
  return () => document.removeEventListener('visibilitychange', apply);
};
