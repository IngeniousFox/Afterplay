import type { MemoryActivityEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que la cola de recaps avanza, o de que un periodo
// concreto acaba de recibir el suyo. El patrón (función inyectada desde
// main/index.ts, que es quien tiene la ventana) vive en lib/makeNotifier.
const notifier = makeNotifier<MemoryActivityEvent>();

export const setMemoriesNotifier = notifier.set;
export const notifyMemoriesActivity = notifier.notify;
