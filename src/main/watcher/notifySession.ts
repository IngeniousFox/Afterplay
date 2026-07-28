import type { SessionClosedEvent } from '../../shared/types';

// Aviso al renderer de que un juego se acaba de cerrar. Mismo patrón que
// saves/notify.ts y watcher/runningGames.ts: una función inyectada desde
// main/index.ts (que es quien tiene la ventana y sabe si está visible), para
// que el watcher no dependa de Electron ni de quién sea la ventana ahora.
//
// La decisión de "toast dentro de la app" contra "notificación de Windows" NO
// se toma aquí: la toma index.ts, que es el único que sabe si la ventana está
// oculta en la bandeja.

let send: (event: SessionClosedEvent) => void = () => {};

export const setSessionClosedNotifier = (notifier: (event: SessionClosedEvent) => void): void => {
  send = notifier;
};

export const notifySessionClosed = (event: SessionClosedEvent): void => {
  try {
    send(event);
  } catch {
    // La ventana puede estar cerrándose o no existir todavía. Un aviso
    // perdido no rompe nada: la sesión ya está guardada, y su nota se puede
    // escribir igual desde la fila de la sesión.
  }
};
