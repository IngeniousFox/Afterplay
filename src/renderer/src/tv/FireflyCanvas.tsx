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

export type FireflySpec = {
  // Posición base en % del viewport — la deriva orbita alrededor.
  left: number;
  top: number;
  // Diámetro visual del núcleo en em (la escala 10-foot del modo).
  size: number;
  color: string;
  // Aurora grande y difusa en vez de bolita.
  big: boolean;
};

const FRAME_MS = 1000 / 30;
const SPRITE_SIZE = 128;

export const FireflyCanvas = ({
  orbs,
  active = true,
}: {
  orbs: FireflySpec[];
  // El cielo solo se PINTA cuando está a escena (sin arte de fondo). Con
  // active=false el bucle deja de trabajar en cuanto acaba el fundido del
  // wrapper (~700ms) — un canvas invisible dibujando 331 luces a 30fps era
  // calefacción, no ambiente.
  active?: boolean;
}): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Datos frescos sin reiniciar el bucle: la biblioteca puede refrescarse
  // (estados que cambian de color) y el cielo se actualiza al vuelo.
  const orbsRef = useRef(orbs);
  useEffect(() => {
    orbsRef.current = orbs;
  });
  const activeRef = useRef(active);
  const inactiveSinceRef = useRef(0);
  useEffect(() => {
    if (!active && activeRef.current) inactiveSinceRef.current = performance.now();
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let em = 24;
    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      em = parseFloat(getComputedStyle(canvas).fontSize) || 24;
    };
    resize();
    window.addEventListener('resize', resize);

    // El horno de sprites: un gradiente radial por (color, tipo), una vez.
    const sprites = new Map<string, HTMLCanvasElement>();
    const spriteFor = (color: string, big: boolean): HTMLCanvasElement => {
      const key = big ? `big:${color}` : color;
      const cached = sprites.get(key);
      if (cached) return cached;
      const sprite = document.createElement('canvas');
      sprite.width = SPRITE_SIZE;
      sprite.height = SPRITE_SIZE;
      const spriteContext = sprite.getContext('2d');
      if (spriteContext) {
        const half = SPRITE_SIZE / 2;
        const gradient = spriteContext.createRadialGradient(half, half, 0, half, half, half);
        if (big) {
          // La aurora: una respiración ancha y tenue — el blur(30px) de
          // antes, horneado gratis en el degradado.
          gradient.addColorStop(0, `${color}2e`);
          gradient.addColorStop(0.65, `${color}0d`);
          gradient.addColorStop(1, `${color}00`);
        } else {
          // Núcleo DEFINIDO: chispa blanca en el centro (como una
          // luciérnaga de verdad), meseta encendida del color y una caída
          // CORTA que muere antes del borde del sprite — la cola larga de
          // la primera versión convertía el cielo denso en gachas de luz.
          gradient.addColorStop(0, '#ffffffd9');
          gradient.addColorStop(0.1, `${color}ff`);
          gradient.addColorStop(0.32, `${color}d9`);
          gradient.addColorStop(0.52, `${color}52`);
          gradient.addColorStop(0.8, `${color}00`);
          gradient.addColorStop(1, `${color}00`);
        }
        spriteContext.fillStyle = gradient;
        spriteContext.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
      }
      sprites.set(key, sprite);
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
      // Fuera de escena (arte de fondo delante): se sigue pintando solo
      // mientras dura el fundido de salida del wrapper, y después ni un
      // ciclo más.
      if (!activeRef.current && now - inactiveSinceRef.current > 900) return;

      const t = now / 1000;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      const list = orbsRef.current;
      const total = list.length || 1;
      // LA LEY DEL ENJAMBRE: se conserva la ENERGÍA total de luz, no la de
      // cada luciérnaga. Con 'lighter' las luces SUMAN, y a miles el cielo
      // saturaba a supernova — así que la intensidad individual cae con
      // 1/√n (cada brasa se sigue viendo, pero el conjunto no ciega).
      // Referencia: ~200 luces = intensidad plena (afinada a ojo en
      // pantalla: 170 quedaba mortecino a 4000, 300 pasado de rosca).
      const damp = Math.min(1, Math.sqrt(200 / total));
      // Y las AURORAS no escalan con la biblioteca: ~13 pase lo que pase.
      // A 4000 luces, "cada décima es aurora" eran 400 manchas de 20% de
      // pantalla — el grueso del incendio. Las sobrantes se pintan como
      // luciérnagas normales: el juego sigue ahí, solo que sin capa.
      const bigStride = Math.max(1, Math.ceil(total / 130));
      // Con el cielo denso, núcleos y halos encogen un punto: menos solape
      // = menos suma = más noche entre las luces. (Suavizado tras verlo: el
      // encogido fuerte + la cola larga del sprite viejo emborronaban.)
      const sizeScale = 0.85 + 0.15 * damp;
      const haloScale = 1.0 + 0.35 * damp;

      for (let i = 0; i < total; i++) {
        const orb = list[i];
        const isBig = orb.big && Math.floor(i / 10) % bigStride === 0;

        // LOS CORRILLOS: las luciérnagas de verdad no se reparten uniformes
        // por el prado — se juntan. Siete centros deterministas derivando
        // muy despacio; ~2/3 de las luces se acercan al suyo a medio camino
        // y el resto quedan libres entre corrillos. El censo sigue siendo
        // exacto (una luz por juego); solo la geografía se vuelve orgánica.
        // Multiplicadores DESCORRELACIONADOS a propósito (61/29): con la
        // primera pareja (137/83) los siete centros caían en una diagonal —
        // un solo enjambre en banda en vez de corrillos repartidos.
        const k = i % 7;
        const clusterLeft = ((k * 61 + 13) % 88) + 6 + Math.sin(t * 0.02 + k * 2.1) * 4;
        const clusterTop = ((k * 29 + 37) % 70) + 12 + Math.cos(t * 0.016 + k * 1.4) * 3;
        const pull = i % 10 < 7 ? 0.55 : 0;
        const baseLeft = orb.left + (clusterLeft - orb.left) * pull;
        const baseTop = orb.top + (clusterTop - orb.top) * pull;

        // LA PROFUNDIDAD: cada luz vive en un plano (z 0.6 cerca de la
        // lejanía → ~1.5 en primer término). Las cercanas son más grandes,
        // más brillantes y derivan más (paralaje); las lejanas, chispitas
        // lentas. Tres capas de noche en un solo canvas.
        const z = 0.6 + ((i * 13) % 8) / 8;

        // La deriva: dos senos por eje con periodos coprimos-ish y fase
        // áurea (i * 2.399) — órbitas suaves que no se repiten entre luces.
        const w1 = (0.045 + (i % 7) * 0.011) * (0.55 + z * 0.45);
        const w2 = (0.03 + (i % 5) * 0.009) * (0.55 + z * 0.45);
        const p1 = i * 2.399;
        const p2 = i * 1.111;
        const ax = (2.2 + (i % 4)) * (width / 100) * (0.45 + z * 0.55);
        const ay = (2.6 + (i % 3)) * (height / 100) * (0.45 + z * 0.55);
        const x =
          (baseLeft / 100) * width +
          Math.sin(t * w1 + p1) * ax +
          Math.sin(t * w2 + p2 * 0.7) * ax * 0.4;
        const y =
          (baseTop / 100) * height +
          Math.cos(t * w2 + p2) * ay +
          Math.sin(t * w1 * 0.8 + p1 * 1.3) * ay * 0.35;

        if (isBig) {
          // Las auroras siguen siendo nubes que respiran — sin parpadeo.
          const breath = 0.65 + 0.35 * Math.sin(t * (0.25 + (i % 6) * 0.05) + i);
          const radius = width * 0.1;
          context.globalAlpha = (0.55 * breath + 0.06) * damp;
          context.drawImage(
            spriteFor(orb.color, true),
            x - radius,
            y - radius,
            radius * 2,
            radius * 2,
          );
          continue;
        }

        // EL PARPADEO: una luciérnaga pasa la mayor parte del tiempo en
        // brasa tenue y DESTELLA — el destello es la firma de la especie,
        // lo que el aliento sinusoidal de antes nunca tuvo. Ciclo propio
        // por índice (5-11s), destello del ~14% del ciclo con subida y
        // bajada en seno; entre destellos queda la brasa respirando bajito.
        const period = 5 + ((i * 11) % 13) * 0.46;
        const phase = ((t + i * 1.7) % period) / period;
        const flash = phase < 0.14 ? Math.sin((phase / 0.14) * Math.PI) : 0;
        const ember = 0.3 + 0.18 * Math.sin(t * (0.25 + (i % 6) * 0.05) + i);
        const depthAlpha = 0.5 + z * 0.35;

        // El destello también HINCHA la luz un punto — el pop se ve antes
        // que el brillo a tres metros.
        const radius = orb.size * sizeScale * em * haloScale * z * (1 + flash * 0.3);

        context.globalAlpha = Math.min(1, (ember + flash * 0.85) * depthAlpha * damp);
        context.drawImage(
          spriteFor(orb.color, false),
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );
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
