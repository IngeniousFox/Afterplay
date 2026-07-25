import type { SavesActivityEvent } from './contracts';

// Aviso al renderer de que una copia automática está pasando AHORA. Existe
// porque el backup por cierre de sesión (PARTIDAS-GUARDADAS.md §10.2) ocurre
// entero en el main: sin esto, la ficha del juego que tienes delante se
// queda con la foto de antes y no hay forma de saber que algo se está
// subiendo — ni de enterarse cuando termina, salvo cambiando de pantalla y
// volviendo.
//
// Mismo patrón que watcher/runningGames.ts: una función inyectada desde
// main/index.ts, que es quien tiene la ventana. Así este módulo no depende
// de Electron ni de quién sea la ventana en cada momento.

let send: (event: SavesActivityEvent) => void = () => {};

export const setSavesNotifier = (notifier: (event: SavesActivityEvent) => void): void => {
  send = notifier;
};

export const notifySavesActivity = (event: SavesActivityEvent): void => {
  try {
    send(event);
  } catch {
    // La ventana puede estar cerrándose (o no existir todavía). Un aviso
    // perdido no rompe nada: el backup sigue su curso igual.
  }
};
