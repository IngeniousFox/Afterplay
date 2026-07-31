import { useEffect, useRef, useState } from 'react';

// ¿Llevas un rato sin tocar LA APP? Ojo: la app, no el ordenador.
//
// La primera versión preguntaba al sistema (powerMonitor.getSystemIdleTime) y
// estaba mal planteada: con Afterplay abierta detrás y tú escribiendo en el
// navegador, el sistema decía "activo" y el modo ambiente no entraba nunca.
// Pero la app SÍ estaba sola — que es justo el momento en el que tiene
// sentido. Perder el foco cuenta como no tocarla: no se reinicia el contador
// al irte a otra ventana, precisamente para que entre mientras estás en otra
// cosa.
//
// Sondeo cada segundo sobre una marca de tiempo, en vez de un temporizador
// que se crea y destruye en cada movimiento del ratón.
const POLL_MS = 1000;

// 'afterplay:activity' es la actividad SINTÉTICA del mando en modo TV
// (tv/gamepad.ts la despacha en cada pulsación): el gamepad no genera
// eventos DOM, y sin esta vía el modo ambiente te taparía la pantalla
// mientras navegas con el mando.
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'wheel',
  'touchstart',
  'afterplay:activity',
] as const;

export const useIdle = (
  thresholdSeconds: number,
  enabled: boolean,
  // Se consulta en CADA sondeo, no solo al montar: sirve para condiciones que
  // cambian por su cuenta mientras el hook vive (p. ej. abrir un modal).
  // Tiene que ser estable — declararla a nivel de módulo, no en el render.
  isBlocked?: () => boolean,
): boolean => {
  const [idle, setIdle] = useState(false);
  // 0 y no Date.now(): leer el reloj durante el render es impuro
  // (react-hooks/purity). El efecto lo pone en hora nada más montar, que es
  // el momento en que empieza a contar de verdad.
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    lastActivityRef.current = Date.now();

    const bump = (): void => {
      lastActivityRef.current = Date.now();
      setIdle(false);
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, bump, { passive: true });
    }
    // Volver a la ventana cuenta como tocarla: si vuelves de otra app, lo
    // primero que quieres ver es tu app, no el salvapantallas.
    window.addEventListener('focus', bump);

    const timer = setInterval(() => {
      if (isBlocked?.()) {
        lastActivityRef.current = Date.now();
        setIdle(false);
        return;
      }
      setIdle(Date.now() - lastActivityRef.current >= thresholdSeconds * 1000);
    }, POLL_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, bump);
      window.removeEventListener('focus', bump);
      clearInterval(timer);
    };
  }, [thresholdSeconds, enabled, isBlocked]);

  // Deshabilitado cuenta como "no inactivo" SIN tocar el estado: apagarlo con
  // un setIdle(false) dentro del efecto es una cascada de renders evitable
  // (react-hooks/set-state-in-effect), y aquí basta con derivarlo.
  return enabled && idle;
};
