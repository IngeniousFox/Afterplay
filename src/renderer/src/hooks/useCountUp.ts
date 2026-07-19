import { useEffect, useState } from 'react';

// Anima un número de 0 a `target` con ease-out cúbico (~700ms) — el efecto
// "contador que sube" de las métricas al entrar a las stats de un juego.
// Si target cambia (navegar a otro juego), vuelve a animar hacia el nuevo.
export const useCountUp = (target: number, durationMs = 700): number => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Sin nada que animar no se arranca el rAF — el render de abajo ya
    // devuelve el target directamente en ese caso.
    if (target <= 0) return undefined;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cúbico: arranca rápido y frena al llegar — se siente como
      // un contador que "aterriza", no un cronómetro lineal.
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return target <= 0 ? target : value;
};
