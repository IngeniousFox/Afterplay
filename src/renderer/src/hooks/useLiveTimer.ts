import { useEffect, useState } from 'react';

// Segundos transcurridos desde `startedAt`, actualizado cada segundo. Si
// `startedAt` es null (no hay sesión en marcha), devuelve 0 y no arranca
// ningún intervalo — solo las cards que de verdad están en directo pagan el
// coste de re-renderizarse cada segundo, no toda la lista entera (a
// diferencia del prototipo, que re-renderiza todo desde un tick global).
export const useLiveTimer = (startedAt: Date | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, (now - startedAt.getTime()) / 1000);
};
