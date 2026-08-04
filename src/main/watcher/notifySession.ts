import type { SessionClosedEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que un juego se acaba de cerrar. El patrón (función
// inyectada desde main/index.ts, que es quien tiene la ventana y sabe si está
// visible) vive en lib/makeNotifier.
//
// La decisión de "toast dentro de la app" contra "notificación de Windows" NO
// se toma aquí: la toma index.ts, que es el único que sabe si la ventana está
// oculta en la bandeja.
const notifier = makeNotifier<SessionClosedEvent>();

export const setSessionClosedNotifier = notifier.set;
export const notifySessionClosed = notifier.notify;
