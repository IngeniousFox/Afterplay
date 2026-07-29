import type { CuriosityActivityEvent } from '../../shared/types';

// Aviso al renderer de que la generación de curiosidades avanza (el backfill
// de Ajustes) o de que un juego concreto acaba de recibir las suyas. Mismo
// patrón que saves/notify.ts: función inyectada desde main/index.ts, que es
// quien tiene la ventana — este módulo no depende de Electron.

let send: (event: CuriosityActivityEvent) => void = () => {};

export const setCuriositiesNotifier = (notifier: (event: CuriosityActivityEvent) => void): void => {
  send = notifier;
};

export const notifyCuriositiesActivity = (event: CuriosityActivityEvent): void => {
  try {
    send(event);
  } catch {
    // La ventana puede estar cerrándose. Un aviso perdido no rompe nada: las
    // curiosidades ya están en la DB y la próxima carga las verá igual.
  }
};
