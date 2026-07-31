import type { MemoryActivityEvent } from '../../shared/types';

// Aviso al renderer de que la cola de recaps avanza, o de que un periodo
// concreto acaba de recibir el suyo. Mismo patrón que curiosities/notify.ts:
// función inyectada desde main/index.ts (quien tiene la ventana) — este
// módulo no depende de Electron.

let send: (event: MemoryActivityEvent) => void = () => {};

export const setMemoriesNotifier = (notifier: (event: MemoryActivityEvent) => void): void => {
  send = notifier;
};

export const notifyMemoriesActivity = (event: MemoryActivityEvent): void => {
  try {
    send(event);
  } catch {
    // La ventana puede estar cerrándose. Un aviso perdido no rompe nada: el
    // recap ya está en la DB y la próxima carga lo verá igual.
  }
};
