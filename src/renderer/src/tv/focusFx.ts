import { EASE, prefersReducedMotion } from '../components/fx/motion';
import {
  TV_SPARK_COUNT,
  TV_SPARK_MS,
  TV_SPARK_REACH_PX,
  TV_TRAIL_MS,
  TV_TRAIL_OPACITY,
} from './styles';

// LOS EFECTOS DEL FOCO A 10 PIES («rock and roll», fase B). Sin componentes
// (Fast Refresh): el que los dispara es TvFocusFx.tsx y el layout.
//
//   · La estela: al saltar de fila, un fantasma del anillo viaja del sitio
//     viejo al nuevo y otro se queda donde estaba, apagándose: el fósforo que
//     persiste. 300 ms.
//   · La chispa de A: un anillo que se abre y ocho motas que salen del centro
//     de lo enfocado. 440 ms.
//   · El punto de foco que leen las motas del fondo (FireflyCanvas).
//
// Todo son nodos `fixed` propios colgados de <body> (por encima del modo TV,
// sin eventos) que animan SOLO transform y opacity con WAAPI y se retiran al
// acabar. Nada vive más que su animación. Reduced motion: sin estela, y la
// chispa queda en un destello de opacidad sin movimiento.
//
// Quién está enfocado lo dice el atributo data-tv-fx-focus que pone
// useTvFocusable (focusContext.ts); si dentro hay un [data-tv-fx-ring] (la
// portada de una carátula, sin su título), la geometría es la suya.

const LAYER_Z = '45';

export const findTvFocused = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-tv-fx-focus]');

const ringOf = (element: HTMLElement): HTMLElement =>
  element.querySelector<HTMLElement>('[data-tv-fx-ring]') ?? element;

export const tvRingRect = (element: HTMLElement): DOMRect =>
  ringOf(element).getBoundingClientRect();

// La escala de la tele: las medidas en px de styles.ts son a 1080p.
const tvScale = (): number => Math.max(0.6, window.innerHeight / 1080);

const fixedLayer = (rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HTMLDivElement => {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  Object.assign(element.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: LAYER_Z,
  });
  document.body.appendChild(element);
  return element;
};

// ── El punto de foco para las motas ─────────────────────────────────────────
// Un objeto mutable y no estado de React: el lienzo lo lee en su bucle, a 30
// fps, sin re-renderizar nada.
export const tvFocusGlow = { x: 0, y: 0, active: false };

export const publishTvFocusGlow = (element: HTMLElement | null): void => {
  if (!element || !element.isConnected) {
    tvFocusGlow.active = false;
    return;
  }
  const rect = tvRingRect(element);
  tvFocusGlow.x = rect.left + rect.width / 2;
  tvFocusGlow.y = rect.top + rect.height / 2;
  tvFocusGlow.active = true;
};

// ── La estela ───────────────────────────────────────────────────────────────
let stopTrail: (() => void) | null = null;

const RING_SHADOW =
  '0 0 0 2px rgb(255 179 71 / 0.85), 0 0 28px rgb(255 179 71 / 0.55), inset 0 0 24px rgb(255 179 71 / 0.25)';

export const playTvTrail = (from: DOMRect, target: HTMLElement): void => {
  if (prefersReducedMotion() || typeof target.animate !== 'function') return;
  stopTrail?.();
  const to = tvRingRect(target);
  if (from.width === 0 || to.width === 0) return;
  const radius = getComputedStyle(ringOf(target)).borderRadius || '4px';

  // El fantasma que se queda: el anillo viejo apagándose donde estaba.
  const afterglow = fixedLayer(from);
  Object.assign(afterglow.style, {
    borderRadius: radius,
    boxShadow: RING_SHADOW,
    background: 'rgb(255 179 71 / 0.1)',
  });
  const fade = afterglow.animate([{ opacity: TV_TRAIL_OPACITY * 0.8 }, { opacity: 0 }], {
    duration: TV_TRAIL_MS * 1.3,
    easing: EASE.out,
    fill: 'forwards',
  });

  // El cometa: el mismo anillo viajando al sitio nuevo y apagándose.
  const comet = fixedLayer(from);
  Object.assign(comet.style, {
    borderRadius: radius,
    boxShadow: RING_SHADOW,
    transformOrigin: '0 0',
    mixBlendMode: 'screen',
  });
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const travel = comet.animate(
    [
      { transform: 'none', opacity: TV_TRAIL_OPACITY },
      {
        offset: 0.7,
        opacity: TV_TRAIL_OPACITY * 0.5,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})`,
        opacity: 0,
      },
    ],
    { duration: TV_TRAIL_MS, easing: EASE.out, fill: 'forwards' },
  );

  // El destino puede deslizarse (el scroll suave del motor de foco): la
  // propiedad `translate` se suma al transform animado y corrige el rumbo
  // frame a frame. Una lectura de rect por frame, solo mientras dura.
  let raf = 0;
  const track = (): void => {
    const now = tvRingRect(target);
    comet.style.translate = `${now.left - to.left}px ${now.top - to.top}px`;
    raf = requestAnimationFrame(track);
  };
  raf = requestAnimationFrame(track);

  const cleanup = (): void => {
    cancelAnimationFrame(raf);
    afterglow.remove();
    comet.remove();
    if (stopTrail === cleanup) stopTrail = null;
  };
  stopTrail = cleanup;
  void Promise.allSettled([travel.finished, fade.finished]).then(cleanup);
};

// ── La chispa de A ──────────────────────────────────────────────────────────
const SPARK_COLORS = ['#ffb347', '#ffc266', '#ffe2b0', '#5fd3e0'];

export const sparkTvFocus = (element: HTMLElement): void => {
  if (typeof element.animate !== 'function') return;
  const rect = tvRingRect(element);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const box = fixedLayer({ left: cx, top: cy, width: 0, height: 0 });
  const animations: Animation[] = [];

  const glow = document.createElement('div');
  const glowSize = Math.min(rect.width, rect.height) * 1.4;
  Object.assign(glow.style, {
    position: 'absolute',
    left: `${-glowSize / 2}px`,
    top: `${-glowSize / 2}px`,
    width: `${glowSize}px`,
    height: `${glowSize}px`,
    borderRadius: '50%',
    background: 'radial-gradient(closest-side, rgb(255 210 140 / 0.55), transparent)',
    mixBlendMode: 'screen',
  });
  box.appendChild(glow);
  animations.push(
    glow.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: TV_SPARK_MS * 0.6,
      easing: EASE.out,
      fill: 'forwards',
    }),
  );

  if (!prefersReducedMotion()) {
    const scale = tvScale();
    const ringSize = Math.min(rect.width, rect.height) * 0.55;
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute',
      left: `${-ringSize / 2}px`,
      top: `${-ringSize / 2}px`,
      width: `${ringSize}px`,
      height: `${ringSize}px`,
      borderRadius: '50%',
      border: '2px solid #ffb347',
      boxShadow: '0 0 14px rgb(255 179 71 / 0.6)',
    });
    box.appendChild(ring);
    animations.push(
      ring.animate(
        [
          { transform: 'scale(0.35)', opacity: 0.95 },
          { transform: 'scale(1.9)', opacity: 0 },
        ],
        { duration: TV_SPARK_MS, easing: EASE.out, fill: 'forwards' },
      ),
    );

    for (let index = 0; index < TV_SPARK_COUNT; index++) {
      // Reparto determinista: ángulos repartidos con un desfase áureo y
      // alcances algo distintos, para que no parezca un asterisco.
      const angle = (index / TV_SPARK_COUNT) * Math.PI * 2 + 0.4;
      const reach = TV_SPARK_REACH_PX * scale * (0.7 + ((index * 37) % 10) / 22);
      const size = (3 + (index % 3)) * scale;
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        position: 'absolute',
        left: `${-size / 2}px`,
        top: `${-size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: SPARK_COLORS[index % SPARK_COLORS.length],
        boxShadow: `0 0 ${size * 2}px ${SPARK_COLORS[index % SPARK_COLORS.length]}`,
      });
      box.appendChild(dot);
      animations.push(
        dot.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            {
              transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) scale(0.3)`,
              opacity: 0,
            },
          ],
          {
            duration: TV_SPARK_MS * (0.8 + (index % 4) * 0.07),
            easing: EASE.out,
            fill: 'forwards',
          },
        ),
      );
    }
  }

  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() =>
    box.remove(),
  );
};
