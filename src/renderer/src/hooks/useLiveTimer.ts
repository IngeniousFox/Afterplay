import { useEffect, useState } from 'react';

// Segundos transcurridos desde `startedAt`, actualizado cada segundo. Si
// `startedAt` es null (no hay sesión en marcha), devuelve 0 y no arranca
// ningún intervalo — solo las cards que de verdad están en directo pagan el
// coste de re-renderizarse cada segundo, no toda la lista entera (a
// diferencia del prototipo, que re-renderiza todo desde un tick global).
//
// Con la página OCULTA (minimizada, en la bandeja, o totalmente tapada — la
// misma señal de visibilidad que usePageVisible) el intervalo se PARA: tickear
// hacia una ventana que nadie ve es el estado TÍPICO de este hook, porque
// mientras juegas la app está detrás y cada juego vivo mantiene 2+
// consumidores montados (su GameCard de la parrilla + NowPlayingCard del
// sidebar). Medido en bench (bailout eager de React incluido): 300 renders
// por consumidor en 5 min ocultos → 0. Y no es solo lo que Chromium
// estrangularía él solo: el throttling de fondo deja este intervalo a 1 Hz
// los primeros 5 minutos y el trabajo por render se paga igual.
//
// El valor NO se pierde al pausar: sale de `startedAt` y del reloj, no de
// acumular ticks. Al volver a ser visible, el setNow inmediato del handler lo
// pone en hora en ese mismo commit — sin él, el primer fotograma tras
// restaurar enseñaba la foto de antes de minimizar (hasta 1s con throttling
// normal, hasta 60s con el intensivo) antes del tick siguiente.
export const useLiveTimer = (startedAt: Date | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (interval !== null) return;
      interval = setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = (): void => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop();
      } else {
        // Ponerse en hora ANTES del primer tick nuevo. Si el milisegundo
        // coincide (restaurar en <1ms, o un visibilitychange repetido), el
        // bailout de React lo deja en nada.
        setNow(Date.now());
        start();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    // Montar con la página ya oculta (sesión detectada con la app en la
    // bandeja) tampoco arranca nada: se pagará cuando haya alguien mirando.
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, (now - startedAt.getTime()) / 1000);
};
