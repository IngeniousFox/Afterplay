import { useEffect, useState } from 'react';

// Los milisegundos que faltan para `deadline` (ms epoch), con un tick por
// segundo. Se calcula contra el reloj local en cada tick, igual que
// useLiveSeconds: una pestaña suspendida no desvía la cuenta. Con `null` no
// hay nada que contar y devuelve 0.
export const useCountdown = (deadline: number | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const tick = (): void => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return deadline === null ? 0 : Math.max(0, deadline - now);
};
