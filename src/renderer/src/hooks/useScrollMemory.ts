import { useCallback } from 'react';

// Posiciones vivas a nivel de módulo — sobreviven al desmontaje de la
// pantalla (navegar al detalle de un juego y volver) pero no al reinicio de
// la app, que es exactamente lo que se quiere: memoria de sesión, no
// preferencia persistente.
const positions = new Map<string, number>();

// Recordar el scroll de un contenedor con overflow propio entre montajes —
// el ScrollRestoration de react-router solo sabe de window, y aquí cada
// pantalla scrollea su propio div. Callback-ref y no useRef+useEffect: se
// restaura en el instante en que el nodo se engancha (antes del pintado) y
// el compilador de React no ve ningún ref leído en render. Funciona porque
// los datos de la lista están cacheados (staleTime Infinity): al volver, la
// lista ya se pinta a altura completa y el scrollTop restaurado "cabe".
// El scroll guardado de una pantalla, para decisiones de PRIMER render (el
// Plan lo usa para saber si puede montar su cola por tandas o si tiene que
// pintarla entera de golpe porque hay un scroll profundo que restaurar).
// Lectura de una vez en un inicializador de useState — no una suscripción.
export const getStoredScroll = (key: string): number => positions.get(key) ?? 0;

export const useScrollMemory = <T extends HTMLElement>(
  key: string,
): { attachRef: (element: T | null) => void; onScroll: (event: React.UIEvent<T>) => void } => {
  const attachRef = useCallback(
    (element: T | null) => {
      if (element) element.scrollTop = positions.get(key) ?? 0;
    },
    [key],
  );

  const onScroll = useCallback(
    (event: React.UIEvent<T>) => {
      positions.set(key, event.currentTarget.scrollTop);
    },
    [key],
  );

  return { attachRef, onScroll };
};
