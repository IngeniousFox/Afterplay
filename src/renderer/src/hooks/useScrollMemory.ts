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
