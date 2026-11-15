import { useEffect, useState } from 'react';

// La hora actual, refrescada cada `intervalMs` mientras `enabled`. Para lo que
// depende de cuánto hace de algo en una escala de minutos ("No signal for 5
// min"): no hace falta el segundo a segundo de useLiveTimer, y sin `enabled`
// no arranca ningún intervalo (solo las sesiones ajenas en vivo lo pagan).
//
// El primer valor fresco se pide con un timeout 0 y no con un setState en el
// cuerpo del efecto: si `enabled` pasa a true horas después del montaje,
// `now` es la hora de entonces y se pondría en hora enseguida.
export const useNow = (enabled: boolean, intervalMs = 15_000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled, intervalMs]);

  return now;
};
