import { app } from 'electron';

// SPEC 3E — "abierta por Windows al iniciar sesión" debe arrancar oculta en
// la bandeja, no mostrar la ventana. `app.getLoginItemSettings().wasOpenedAtLogin`
// (que este archivo usaba antes) es un campo SOLO de macOS — en Windows viene
// siempre `undefined`, así que esa comprobación era papel mojado ahí: la
// ventana se enseñaba siempre, venga el arranque de Windows o no.
//
// Windows no tiene un equivalente nativo a "sé que me abrió el inicio de
// sesión", así que hay que fabricarse uno: al registrar el inicio automático
// se le pasa un argumento propio (HIDDEN_LAUNCH_ARG), y se comprueba si el
// proceso arrancó con él en `process.argv` — así se distingue de un
// doble-click manual del usuario, que nunca lleva ese argumento.
export const HIDDEN_LAUNCH_ARG = '--hidden';

export const wasOpenedHiddenAtLogin = (): boolean => {
  if (process.platform === 'win32') return process.argv.includes(HIDDEN_LAUNCH_ARG);
  // macOS sí tiene un campo real para esto — se mantiene el comportamiento
  // previo ahí sin cambios.
  if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAtLogin;
  return false;
};
