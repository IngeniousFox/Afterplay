import type { AchievementActivityEvent } from '../../shared/types';

// Aviso al renderer del avance de la sincronización de logros (la pasada de
// Ajustes) y de que un juego concreto acaba de recibir los suyos. Mismo
// patrón que curiosities/notify.ts: función inyectada desde main/index.ts,
// que es quien tiene la ventana — este módulo no depende de Electron.

let send: (event: AchievementActivityEvent) => void = () => {};

export const setAchievementsNotifier = (
  notifier: (event: AchievementActivityEvent) => void,
): void => {
  send = notifier;
};

export const notifyAchievementsActivity = (event: AchievementActivityEvent): void => {
  try {
    send(event);
  } catch {
    // La ventana puede estar cerrándose. Un aviso perdido no rompe nada: los
    // logros ya están en la DB y la próxima carga los verá igual.
  }
};
