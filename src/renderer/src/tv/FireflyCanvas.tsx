import { useEffect, useRef } from 'react';

// EL ENJAMBRE EN UN SOLO LIENZO. La versión DOM pagaba, POR LUCIÉRNAGA, un
// nodo + una capa compuesta en GPU + un box-shadow difuminado (y las
// auroras, un filter:blur(30px) permanente) — a 128 aguantaba, a 500 sería
// una estufa. Aquí el trato es otro:
//
//   · UN canvas 2D y UN rAF para todas. Cero capas por luz.
//   · El brillo va PRE-HORNEADO: un sprite de gradiente radial por color
//     (núcleo + halo en la misma imagen), cacheado — pintar una luciérnaga
//     es un drawImage escalado, que la GPU regala a miles por frame.
//   · La deriva es paramétrica (dos senos por eje, Lissajous suave) con
//     fase/frecuencia derivadas del índice: DETERMINISTA (mismo cielo en
//     cada arranque, sin Math.random) y además cada luciérnaga tiene su
//     ruta única — mejor que las tres rutas CSS que se repartían antes.
//   · 30fps a propósito: una deriva de 14-30s por ciclo no gana nada a 60,
//     y cuesta exactamente el doble. Con la pestaña oculta o el modo
//     ambiente encima (que tapa la pantalla entera), ni se pinta.
//   · DPR capado a 1.5: es un fondo de luces difusas, no tipografía.
//   · 'lighter' al componer: dos luces que se cruzan SUMAN luz, como en el
//     mundo real — el cruce es un destello, no una mancha.
//
// Los datos (posición base, color por estado, tamaño, cuáles son auroras)
// vienen del layout, que es quien conoce la biblioteca.
//
// MEDIDO (banco de pruebas en el mismo Electron, ventana 1920x1080, réplica
// exacta de este bucle): el draw cuesta 0,7 ms de CPU con las 994 luces de la
// biblioteca real, 1,3 ms a 2000 y 2,6 ms a 4000 — lineal y sin un solo frame
// perdido en ninguna de las tallas. A 30 fps eso son ~2% de un núcleo con la
// biblioteca real. O sea: el enjambre NO es el que se come los frames en la
// tele; no hay nada que optimizar aquí, y si algún día lo parece, mídelo
// antes de tocarlo. (Lo único que sí se paga por frame dibujado es el
// querySelector del modo ambiente de abajo: 0,12 ms con la parrilla de
// Library montada — 10.000 nodos —, o sea 0,4% de un núcleo. Se queda: la
// alternativa es cablear un estado global para ahorrar cuatro décimas.)

export type FireflySpec = {
  // Posición base en % del viewport — la deriva orbita alrededor.
  left: number;
  top: number;
  // Diámetro del núcleo en px (2-6): motas de fósforo, no luciérnagas.
  size: number;
  color: string;
};

const FRAME_MS = 1000 / 30;
const SPRITE_SIZE = 64;

// FÓSFORO: las luciérnagas pasan a MOTAS DE FÓSFORO (README-tvpwa.md). Una por
// juego, del color de su estado, 2-6 px con un halo corto y opacidad entre
// .25 y .7. Detrás de todo y sin competir con el texto. Con reduced motion
// se quedan quietas (sin deriva ni respiración): siguen ahí, pero no se
// mueven.
export const FireflyCanvas = ({ orbs }: { orbs: FireflySpec[] }): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Datos frescos sin reiniciar el bucle: la biblioteca puede refrescarse
  // (estados que cambian de color) y el cielo se actualiza al vuelo.
  const orbsRef = useRef(orbs);
  useEffect(() => {
    orbsRef.current = orbs;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    window.addEventListener('resize', resize);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // El horno de sprites: un gradiente radial por color, una vez. Núcleo
    // definido y halo corto que muere antes del borde.
    const sprites = new Map<string, HTMLCanvasElement>();
    const spriteFor = (color: string): HTMLCanvasElement => {
      const cached = sprites.get(color);
      if (cached) return cached;
      const sprite = document.createElement('canvas');
      sprite.width = SPRITE_SIZE;
      sprite.height = SPRITE_SIZE;
      const spriteContext = sprite.getContext('2d');
      if (spriteContext) {
        const half = SPRITE_SIZE / 2;
        const gradient = spriteContext.createRadialGradient(half, half, 0, half, half, half);
        gradient.addColorStop(0, `${color}ff`);
        gradient.addColorStop(0.3, `${color}f2`);
        gradient.addColorStop(0.42, `${color}55`);
        gradient.addColorStop(0.75, `${color}00`);
        gradient.addColorStop(1, `${color}00`);
        spriteContext.fillStyle = gradient;
        spriteContext.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
      }
      sprites.set(color, sprite);
      return sprite;
    };

    let raf = 0;
    let last = 0;
    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      // Pantalla tapada = ni un ciclo de GPU: pestaña oculta o el
      // salvapantallas del modo ambiente encima.
      if (document.hidden) return;
      if (document.querySelector('[data-afterplay-ambient]') !== null) return;

      const still = reducedMotion.matches;
      const t = still ? 0 : now / 1000;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      const list = orbsRef.current;
      const total = list.length;
      // Cielo vacío = cielo vacío (y nada de leer list[0] de una lista vacía).
      if (total === 0) {
        context.globalCompositeOperation = 'source-over';
        return;
      }
      // Con miles de motas la suma de luz satura: la intensidad individual
      // cae con 1/√n por encima de ~200.
      const damp = Math.min(1, Math.sqrt(200 / total));

      for (let i = 0; i < total; i++) {
        const orb = list[i];
        // La deriva: dos senos por eje con fase áurea (i * 2.399) — órbitas
        // lentas que no se repiten entre motas (Lissajous suave).
        const w1 = 0.045 + (i % 7) * 0.011;
        const w2 = 0.03 + (i % 5) * 0.009;
        const p1 = i * 2.399;
        const p2 = i * 1.111;
        const ax = (2.2 + (i % 4)) * (width / 100);
        const ay = (2.6 + (i % 3)) * (height / 100);
        const x =
          (orb.left / 100) * width +
          Math.sin(t * w1 + p1) * ax +
          Math.sin(t * w2 + p2 * 0.7) * ax * 0.4;
        const y =
          (orb.top / 100) * height +
          Math.cos(t * w2 + p2) * ay +
          Math.sin(t * w1 * 0.8 + p1 * 1.3) * ay * 0.35;
        // Opacidad entre .25 y .7, respirando despacio (quieta con reduced
        // motion: el valor medio).
        const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(t * (0.25 + (i % 6) * 0.05) + i);
        context.globalAlpha = (0.25 + 0.45 * breath) * damp;
        // El sprite mide 2,4 veces el núcleo (el núcleo es el 30 % central).
        const radius = orb.size * 1.65;
        context.drawImage(spriteFor(orb.color), x - radius, y - radius, radius * 2, radius * 2);
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
};
