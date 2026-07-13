import { useEffect, useState } from 'react';

// Devuelve `value`, pero retrasado: solo se actualiza cuando `value` lleva
// `delayMs` sin cambiar. Cada vez que el usuario teclea, se reinicia el
// timeout (por eso el cleanup del useEffect) — así solo se dispara una vez
// que ha dejado de escribir, no en cada pulsación.
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
};
