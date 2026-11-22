import { useLayoutEffect, useRef, useState } from 'react';
import { EASE, prefersReducedMotion } from './motion';

// POWER-ON: el encendido del tubo al abrir la app, una vez por carga.
//
// En el escritorio se escala la pantalla entera con un filter de brillo; en
// un móvil eso es repintar toda la app durante casi un segundo. Aquí la app
// se pinta quieta DEBAJO y lo que se anima es una tapa encima, solo con
// transform y opacity:
//   1. un punto de luz se estira en una línea horizontal;
//   2. las dos mitades negras se abren desde la línea (la imagen «se abre» en
//      vertical, como un CRT);
//   3. un destello ámbar que parpadea una vez y se apaga.
// Al acabar la tapa se desmonta: no queda nada encima ni nada corriendo.
//
// Sin eventos (pointer-events none): un toque durante el encendido llega a la
// app. Con reduced motion no se monta. Una red de seguridad la retira aunque
// la animación no llegue a terminar (pestaña en segundo plano al abrir).

const DURATION = 720;
let played = false;

export const PowerOn = (): React.JSX.Element | null => {
  const [done, setDone] = useState(
    () =>
      played ||
      prefersReducedMotion() ||
      typeof document === 'undefined' ||
      typeof document.body.animate !== 'function',
  );
  const top = useRef<HTMLDivElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const line = useRef<HTMLDivElement | null>(null);
  const glow = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (done) return undefined;
    const nodes = [top.current, bottom.current, line.current, glow.current];
    if (nodes.some((node) => node === null)) return undefined;
    const [topNode, bottomNode, lineNode, glowNode] = nodes as HTMLDivElement[];
    const timing: KeyframeAnimationOptions = {
      duration: DURATION,
      easing: EASE.out,
      fill: 'forwards',
    };
    const animations = [
      topNode.animate(
        [
          { transform: 'none' },
          { offset: 0.28, transform: 'none' },
          { transform: 'translateY(-101%)' },
        ],
        timing,
      ),
      bottomNode.animate(
        [
          { transform: 'none' },
          { offset: 0.28, transform: 'none' },
          { transform: 'translateY(101%)' },
        ],
        timing,
      ),
      lineNode.animate(
        [
          { opacity: 0, transform: 'scaleX(0.04)' },
          { offset: 0.12, opacity: 1, transform: 'scaleX(0.04)' },
          { offset: 0.28, opacity: 1, transform: 'scaleX(1)' },
          { offset: 0.5, opacity: 0, transform: 'scaleX(1) scaleY(24)' },
          { opacity: 0, transform: 'scaleX(1) scaleY(24)' },
        ],
        { ...timing, easing: 'linear' },
      ),
      glowNode.animate(
        [
          { opacity: 0 },
          { offset: 0.3, opacity: 0 },
          { offset: 0.46, opacity: 0.6 },
          { offset: 0.6, opacity: 0.18 },
          { offset: 0.7, opacity: 0.38 },
          { opacity: 0 },
        ],
        { ...timing, easing: 'linear' },
      ),
    ];
    const finish = (): void => {
      played = true;
      setDone(true);
    };
    const safety = window.setTimeout(finish, DURATION + 900);
    void Promise.all(animations.map((animation) => animation.finished))
      .then(finish)
      .catch(() => {
        // Cancelada (StrictMode desmonta y vuelve a montar): la siguiente
        // pasada del efecto la repite.
      });
    return () => {
      window.clearTimeout(safety);
      for (const animation of animations) animation.cancel();
    };
  }, [done]);

  if (done) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <div ref={top} className="absolute inset-x-0 top-0 h-1/2 bg-[#050809]" />
      <div ref={bottom} className="absolute inset-x-0 bottom-0 h-1/2 bg-[#050809]" />
      <div
        ref={glow}
        className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_50%,rgb(255_214_150/0.5),rgb(255_179_71/0.16)_50%,transparent_80%)] opacity-0"
      />
      <div
        ref={line}
        className="absolute inset-x-0 top-[calc(50%-1px)] h-0.5 bg-[#fff2dc] opacity-0 shadow-[0_0_18px_4px_rgb(255_179_71/0.75)]"
      />
    </div>
  );
};
