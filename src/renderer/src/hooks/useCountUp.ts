import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../components/fx/motion';

// Anima un número hasta `target` con ease-out cúbico (~700ms): el efecto
// "contador que sube" de las cifras grandes.
//
//   · from 'zero' (por defecto): cada vez que cambia target vuelve a contar
//     desde 0, como al entrar a las stats de otro juego.
//   · from 'previous': cuenta desde lo que se ve ahora (331 → 12 al filtrar).
//     La primera vez cuenta desde 0. Si el target cambia a medias, sigue
//     desde el valor intermedio, sin saltos.
//
// Con reduced motion no hay conteo: devuelve el valor final directamente.
// components/fx/Ticker lo envuelve con el formato y la accesibilidad.
export const useCountUp = (
  target: number,
  durationMs = 700,
  { from = 'zero' }: { from?: 'zero' | 'previous' } = {},
): number => {
  const reduced = useReducedMotion();
  const fromPrevious = from === 'previous';
  const [value, setValue] = useState(0);
  // Lo último pintado, para arrancar desde ahí en modo 'previous'. Solo se
  // lee y escribe dentro del efecto.
  const shown = useRef(0);

  useEffect(() => {
    if (reduced) return undefined;
    // Sin nada que animar no se arranca el rAF: el return de abajo ya
    // devuelve el target directamente en ese caso.
    if (!fromPrevious && target <= 0) return undefined;
    const start = fromPrevious ? shown.current : 0;
    if (start === target) return undefined;

    let raf = 0;
    const began = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - began) / durationMs);
      // Ease-out cúbico: arranca rápido y frena al llegar, como un contador
      // que "aterriza", no un cronómetro lineal.
      const next = start + (target - start) * (1 - Math.pow(1 - t, 3));
      shown.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced, fromPrevious]);

  if (reduced) return target;
  if (!fromPrevious && target <= 0) return target;
  return value;
};
