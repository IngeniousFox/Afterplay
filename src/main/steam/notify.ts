import type { AchievementActivityEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer del avance de la sincronización de logros (la pasada de
// Ajustes) y de que un juego concreto acaba de recibir los suyos. El patrón
// (función inyectada desde main/index.ts, que es quien tiene la ventana) vive
// en lib/makeNotifier.
const notifier = makeNotifier<AchievementActivityEvent>();

export const setAchievementsNotifier = notifier.set;
export const notifyAchievementsActivity = notifier.notify;
