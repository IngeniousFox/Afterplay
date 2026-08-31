// EL SELLO DEL DESPERTAR DEL MODO AMBIENTE (BIG-PICTURE.md 5.5).
//
// La regla: la pulsacion que despierta el salvapantallas se CONSUME — no debe
// actuar sobre lo que hay debajo. Las puertas de teclado (BigPictureLayout,
// TvLibrary) la aplicaban mirando el atributo [data-afterplay-ambient], y ahi
// habia una carrera de calendario de React: el bump de useIdle y la puerta
// son DOS listeners de burbuja sobre window, y entre listener y listener de
// un evento REAL el stack queda vacio — React (prioridad discreta en keydown)
// puede colar su commit en ese microtask y BORRAR el atributo antes de que la
// puerta lo mire. Resultado: la tecla que despierta abria ademas la caratula
// enfocada, segun el ORDEN de registro de los listeners, que nada garantiza.
//
// Este modulo hace la invariante independiente de ese calendario: AmbientMode
// estampa el instante del despertar EN EL MISMO COMMIT que quita el atributo
// (useLayoutEffect, sincrono dentro del commit), y la puerta que llegue
// despues consume el sello UNA vez. La ventana es corta a proposito — cubre
// el hueco entre el commit y el listener (microsegundos) con margen, sin
// reintroducir el medio segundo de teclado muerto que ya se pago una vez.
//
// De un solo uso: consumirlo lo gasta, para que el autorepeat de la tecla
// sujeta (ecos a ~30 ms) solo pierda como mucho el primer eco, no la rafaga.
//
// El mando NO necesita esto: gamepad.ts consulta el atributo en la misma pila
// sincrona de su sondeo, sin microtask de por medio. El raton tampoco: su
// consumo es el hit-test de pointerEvents del velo.
const WAKE_WINDOW_MS = 100;

let wokeAt = 0;

export const stampAmbientWake = (): void => {
  wokeAt = performance.now();
};

export const consumeAmbientWake = (): boolean => {
  if (wokeAt === 0 || performance.now() - wokeAt > WAKE_WINDOW_MS) return false;
  wokeAt = 0;
  return true;
};
