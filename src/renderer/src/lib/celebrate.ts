import confetti from 'canvas-confetti';
import type { Options } from 'canvas-confetti';
import { AMBER, BLUE, GREEN, TEAL, VIOLET } from './colors';

// Confeti al dar un juego por completado. Es lo único de la app que existe
// solo por gusto: terminarte un juego es EL momento del ciclo, y hasta ahora
// la ficha lo trataba igual que a "en pausa" — un evento más en el log.

// La paleta de identidad ENTERA (lib/colors.ts) en vez de la multicolor por
// defecto de la librería, que en un tema oscuro como este canta a plantilla
// ajena. Sale variado de verdad —ámbar, verde, turquesa, azul, violeta,
// rosa— pero sigue siendo Afterplay y no un cotillón genérico. Importados,
// no copiados: si mañana se retoca la paleta, el confeti va con ella.
const COLORS = [
  AMBER,
  '#f5d98a', // ámbar claro: el brillo del oro de "Beaten", que manda aquí
  GREEN,
  TEAL,
  BLUE,
  VIOLET,
  '#e85d72', // el rosa de 'dropped', que como confeti es solo un rosa cálido
  '#ffffff',
];

// Tres tandas encadenadas para que ocupe la pantalla ENTERA y no sea un
// pluf en una esquina: cañonazos desde los dos lados, una lluvia ancha desde
// arriba (la que de verdad llena el centro) y un rebote final más pequeño.
const WAVES: { at: number; options: Options }[] = [
  {
    at: 0,
    options: {
      particleCount: 80,
      angle: 60,
      spread: 75,
      origin: { x: 0, y: 0.8 },
      startVelocity: 65,
    },
  },
  {
    at: 0,
    options: {
      particleCount: 80,
      angle: 120,
      spread: 75,
      origin: { x: 1, y: 0.8 },
      startVelocity: 65,
    },
  },
  {
    at: 220,
    options: {
      particleCount: 110,
      angle: 90,
      spread: 140,
      origin: { x: 0.5, y: 0.1 },
      startVelocity: 32,
      gravity: 0.85,
      ticks: 280,
    },
  },
  { at: 480, options: { particleCount: 55, angle: 75, spread: 110, origin: { x: 0.22, y: 0.5 } } },
  { at: 480, options: { particleCount: 55, angle: 105, spread: 110, origin: { x: 0.78, y: 0.5 } } },
];

// Canvas PROPIO en vez del que se monta la librería sola. Dos motivos: el
// z-index queda fuera de cualquier duda (por encima de modales, banners y de
// lo que se añada mañana), y al colgarlo de <body> ningún contenedor con
// transform/overflow de la app puede recortarlo.
const createCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2147483647';
  document.body.appendChild(canvas);
  return canvas;
};

export const celebrateCompletion = (): void => {
  const canvas = createCanvas();
  const fire = confetti.create(canvas, { resize: true, useWorker: false });

  // OJO: nada de `disableForReducedMotion`. Windows 11 marca
  // prefers-reduced-motion en cuanto apagas "Efectos de animación" en
  // Accesibilidad — que mucha gente hace por rendimiento, no por sensibilidad
  // al movimiento — y la librería se apagaba SIN DECIR NADA. Ese fue el
  // motivo real de que no se viera nada la primera vez.
  const running = WAVES.map(
    (wave) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const done = fire({ colors: COLORS, scalar: 1.05, ...wave.options });
          if (done) void done.then(() => resolve());
          else resolve();
        }, wave.at);
      }),
  );

  // El canvas se va con la última partícula: dejarlo puesto sería un elemento
  // a pantalla completa de por vida, y aunque no capture clicks
  // (pointer-events: none) es basura en el DOM que se acumularía por cada
  // juego completado.
  void Promise.all(running).then(() => canvas.remove());
};
