import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motion';

// Anima un número hasta `target` con ease-out cúbico: el marcador que sube.
// Un rAF de ~700 ms que se apaga solo; no es un bucle.
//
//   · from 'zero' (por defecto): cada vez que cambia target cuenta desde 0.
//   · from 'previous': cuenta desde lo que se ve ahora.
//
// Con reduced motion no hay conteo: devuelve el valor final directamente.
export const useCountUp = (
  target: number,
  durationMs = 700,
  { from = 'zero' }: { from?: 'zero' | 'previous' } = {},
): number => {
  const reduced = useReducedMotion();
  const fromPrevious = from === 'previous';
  const [value, setValue] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    if (reduced) return undefined;
    if (!fromPrevious && target <= 0) return undefined;
    const start = fromPrevious ? shown.current : 0;
    if (start === target) return undefined;

    let raf = 0;
    const began = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - began) / durationMs);
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

// Qué caracteres de `next` son nuevos respecto a `prev`, alineando por la
// derecha (las unidades cambian más que las decenas, y "9:59" → "10:00" crece
// por la izquierda). La misma regla que el odómetro del escritorio.
export const changedChars = (prev: string | null, next: string): boolean[] => {
  if (prev === null) return Array.from(next, () => false);
  const offset = prev.length - next.length;
  return Array.from(next, (char, index) => prev[index + offset] !== char);
};
