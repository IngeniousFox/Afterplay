import type { ExternalRefreshEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que la pasada de datos externos avanza. El patrón
// (función inyectada desde main/index.ts, que es quien tiene la ventana) vive
// en lib/makeNotifier, igual que curiosidades, recaps, logros e imágenes.
const notifier = makeNotifier<ExternalRefreshEvent>();

export const setExternalNotifier = notifier.set;
export const notifyExternalActivity = notifier.notify;
