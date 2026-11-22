import confetti from 'canvas-confetti';
import type { Options } from 'canvas-confetti';
import { EASE, prefersReducedMotion } from './motion';

// SPARKS: chispas de fósforo para los momentos que se celebran. Una función,
// sin componente ni contexto que montar:
//
//   celebrate('session')                     fin de una sesión larga
//   celebrate('record', { origin: el })       un récord, saliendo de su cifra
//   celebrate('achievement' | 'beaten')       un logro, un juego terminado
//
// Paleta Fósforo (ámbar, tube y bone) y formas pequeñas: chispas, no
// cotillón. Cada tipo tiene su tamaño; 'beaten' es la gorda. `origin` es el
// elemento (o su DOMRect) del que salen; sin él, del centro-abajo.
//
// Canvas propio colgado de <body>, por encima de todo y sin eventos, que se
// retira con la última chispa: no queda nada a 60 fps cuando acaba.
//
// Reduced motion: en lugar de chispas, un destello de luz ámbar que se funde
// (400 ms) sobre el origen. Sigue habiendo celebración, sin movimiento.
//
// La celebración de juego completado de la ficha sigue en lib/celebrate.ts
// (su paleta multicolor es a propósito); esta es la del resto de momentos.

export type CelebrationKind = 'session' | 'record' | 'achievement' | 'beaten';

const COLORS = ['#ffb347', '#ffc266', '#e39a2e', '#5fd3e0', '#8ce4ee', '#e9e4d8'];

type Wave = { at: number; options: Options };

const WAVES: Record<CelebrationKind, Wave[]> = {
  session: [
    { at: 0, options: { particleCount: 70, spread: 70, startVelocity: 38, scalar: 0.7 } },
    { at: 180, options: { particleCount: 40, spread: 110, startVelocity: 26, scalar: 0.6 } },
  ],
  record: [
    { at: 0, options: { particleCount: 90, spread: 80, startVelocity: 44, scalar: 0.75 } },
    { at: 160, options: { particleCount: 50, spread: 130, startVelocity: 30, scalar: 0.6 } },
  ],
  achievement: [
    { at: 0, options: { particleCount: 45, spread: 60, startVelocity: 30, scalar: 0.65 } },
  ],
  beaten: [
    { at: 0, options: { particleCount: 110, spread: 90, startVelocity: 50, scalar: 0.8 } },
    { at: 200, options: { particleCount: 80, spread: 150, startVelocity: 34, scalar: 0.65 } },
    { at: 420, options: { particleCount: 50, spread: 120, startVelocity: 24, scalar: 0.55 } },
  ],
};

// Un elemento, o su rectángulo ya medido (útil si el elemento desaparece al
// pulsarlo, como Stop: mídelo en el clic y pásalo después).
export type SparkOrigin = Element | DOMRectReadOnly | null | undefined;

const originOf = (origin: SparkOrigin): { x: number; y: number } => {
  if (!origin) return { x: 0.5, y: 0.8 };
  const rect = origin instanceof Element ? origin.getBoundingClientRect() : origin;
  return {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
};

const layer = (tag: 'canvas' | 'div'): HTMLElement => {
  const element = document.createElement(tag);
  Object.assign(element.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  element.setAttribute('aria-hidden', 'true');
  document.body.appendChild(element);
  return element;
};

const flash = (origin: { x: number; y: number }): void => {
  const glow = layer('div');
  glow.style.background = `radial-gradient(40vmax 40vmax at ${origin.x * 100}% ${origin.y * 100}%, rgb(255 179 71 / 0.28), transparent 70%)`;
  const animation = glow.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 400,
    easing: EASE.out,
    fill: 'forwards',
  });
  void animation.finished.finally(() => glow.remove());
};

// Solo el destello, sin chispas y con o sin reduced motion: una confirmación
// breve («añadido»), no una celebración. Mide el origen al llamarla: si el
// elemento va a desaparecer (un modal que se cierra), pasa su DOMRect.
export const confirmFlash = (origin?: SparkOrigin): void => {
  if (typeof document === 'undefined') return;
  flash(originOf(origin));
};

export const celebrate = (
  kind: CelebrationKind = 'session',
  { origin }: { origin?: SparkOrigin } = {},
): void => {
  if (typeof document === 'undefined') return;
  const at = originOf(origin);
  if (prefersReducedMotion()) {
    flash(at);
    return;
  }

  const canvas = layer('canvas') as HTMLCanvasElement;
  const fire = confetti.create(canvas, { resize: true, useWorker: false });
  const running = WAVES[kind].map(
    (wave) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const done = fire({
            colors: COLORS,
            shapes: ['circle', 'square'],
            ticks: 160,
            gravity: 0.9,
            decay: 0.9,
            angle: 90,
            origin: at,
            ...wave.options,
          });
          if (done) void done.then(() => resolve());
          else resolve();
        }, wave.at);
      }),
  );
  void Promise.all(running).then(() => canvas.remove());
};
