import { useEffect, useState } from 'react';

// El tiempo transcurrido de una sesión abierta, en segundos.
//
// `liveSince` es el startedAt real de la fila, así que el tiempo se calcula
// contra el reloj local en vez de contarse desde que abriste la web: si dejas
// la pestaña abierta veinte minutos y vuelves, el número sigue siendo el
// correcto. Un contador incremental se habría desviado con cada suspensión de
// la pestaña, que en un móvil es constante.
//
// Vive en su propio fichero y no junto al badge que lo usa porque el ESLint de
// la casa lo exige: un módulo que exporta componentes no puede exportar
// además otras cosas, o el fast refresh deja de funcionar en él.
export const useLiveSeconds = (liveSince: number | null): number => {
  const [seconds, setSeconds] = useState(() =>
    liveSince === null ? 0 : Math.max(0, (Date.now() - liveSince) / 1000),
  );

  useEffect(() => {
    if (liveSince === null) return;
    const tick = (): void => setSeconds(Math.max(0, (Date.now() - liveSince) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [liveSince]);

  return seconds;
};
