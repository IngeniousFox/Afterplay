import type Sdl from '@kmamal/sdl';

// Lectura de mandos EN EL PROCESO MAIN (OVERLAY.md §6.1-bis) — la pieza que
// desbloquea el mando para el overlay, y la única forma de leerlo con la app
// en la bandeja: la Web Gamepad API del renderer solo entrega datos con la
// ventana enfocada, y jugando la ventana está oculta.
//
// El hallazgo que lo hace posible sin conflicto: el XInputGetState público de
// Windows ENMASCARA el bit del botón Guía — un juego que lee XInput estándar
// NO PUEDE VER que lo has pulsado. SDL sí lo lee (usa la variante extendida
// por dentro), así que Guía es el único botón del mando del que podemos
// apropiarnos sin disputárselo al juego. Lo mismo vale para el botón PS y el
// Home del Pro Controller, que SDL también mapea a 'guide'.
//
// La B se lee AQUÍ TAMBIÉN, y no con la Web Gamepad API del renderer aunque
// ahí la ventana sí tenga el foco: Chromium solo expone un mando tras su
// propio "gesto de conexión" en la página, y ese baile no se completaba en
// una ventana recién enfocada — la B no llegaba nunca. SDL ya tiene el mando
// abierto: determinista.
//
// Lo que NO se puede hacer: suprimir Guía para los demás (§6.1-bis). Con
// Steam abierto, Guía abrirá su overlay Y el nuestro — Steam lo intercepta
// inyectándose, que es justo lo que aquí está prohibido (§2.3).
//
// FALLO TOLERADO POR DISEÑO (§11): si SDL no carga (binario que falta, una
// plataforma sin prebuild), el overlay se queda en teclado y ratón y todo lo
// demás intacto — un aviso en consola y a otra cosa, jamás un crash.
//
// RUIDO CONOCIDO en consola: "SDL silent error: Unexpected controller
// element crc". Lo imprime la capa NATIVA de @kmamal/sdl (un fprintf a
// stderr en controller.cpp) cuando SDL parsea una entrada de la base de
// mapeos de mandos con el campo `crc:`, más nuevo que su build. Es cosmético
// — el mando se abre igual y Guía/B funcionan — y no se puede silenciar
// desde JS. Se deja constancia para no volver a investigarlo.

type ControllerInstance = { close: () => void };
type SdlModule = typeof Sdl;

export type OverlayButton = 'guide' | 'b';

let sdl: SdlModule | null = null;
let sdlFailed = false;
let running = false;
let onButton: ((button: OverlayButton) => void) | null = null;
let instances: ControllerInstance[] = [];

const closeAll = (): void => {
  for (const instance of instances) {
    try {
      instance.close();
    } catch {
      // Un mando desenchufado a mitad puede dejar la instancia ya muerta.
    }
  }
  instances = [];
};

const openAll = (): void => {
  if (!sdl || !running) return;
  closeAll();
  for (const device of sdl.controller.devices) {
    try {
      const instance = sdl.controller.openDevice(device);
      instance.on('buttonDown', (event) => {
        if (!running) return;
        if (event.button === 'guide' || event.button === 'b') onButton?.(event.button);
      });
      instances.push(instance);
    } catch (error) {
      // Un dispositivo que no se deja abrir (otro proceso lo tiene en
      // exclusiva) no debe impedir leer los demás.
      console.warn('[gamepad] no pude abrir un mando (sigo con el resto):', error);
    }
  }
};

// Los enchufes y desenchufes en caliente re-sincronizan TODO: más simple que
// llevar la cuenta de qué instancia era de qué device, y un mando de más o
// de menos es un evento raro — no un camino caliente que optimizar.
const handleDeviceChange = (): void => {
  if (running) openAll();
};

export const startGuideWatcher = async (
  callback: (button: OverlayButton) => void,
): Promise<void> => {
  onButton = callback;
  if (running || sdlFailed) return;
  running = true;

  if (!sdl) {
    try {
      // Import dinámico y no estático a propósito: SDL solo se paga (carga
      // de binario nativo incluida) la primera vez que hay un juego vivo con
      // el overlay encendido — y si no existe binario para esta máquina, el
      // fallo queda contenido aquí.
      sdl = (await import('@kmamal/sdl')).default;
    } catch (error) {
      sdlFailed = true;
      running = false;
      console.warn(
        '[gamepad] SDL no disponible: el overlay se queda en teclado y ratón (OVERLAY.md §11):',
        error,
      );
      return;
    }
    sdl.controller.on('deviceAdd', handleDeviceChange);
    sdl.controller.on('deviceRemove', handleDeviceChange);
  }

  // stopGuideWatcher pudo llegar mientras el import estaba en vuelo.
  if (running) openAll();
};

export const stopGuideWatcher = (): void => {
  running = false;
  onButton = null;
  closeAll();
};
