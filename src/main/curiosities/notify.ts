import type { CuriosityActivityEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que la generación de curiosidades avanza (el backfill
// de Ajustes) o de que un juego concreto acaba de recibir las suyas. El patrón
// (función inyectada desde main/index.ts, que es quien tiene la ventana) vive
// en lib/makeNotifier.
const notifier = makeNotifier<CuriosityActivityEvent>();

export const setCuriositiesNotifier = notifier.set;
export const notifyCuriositiesActivity = notifier.notify;
