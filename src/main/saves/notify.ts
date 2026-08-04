import type { SavesActivityEvent } from './contracts';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que una copia automática está pasando AHORA. Existe
// porque el backup por cierre de sesión (PARTIDAS-GUARDADAS.md §10.2) ocurre
// entero en el main: sin esto, la ficha del juego que tienes delante se queda
// con la foto de antes y no hay forma de saber que algo se está subiendo — ni
// de enterarse cuando termina, salvo cambiando de pantalla y volviendo.
//
// El patrón (función inyectada desde main/index.ts, que es quien tiene la
// ventana) vive en lib/makeNotifier — antes estaba copiado en cinco módulos.
const notifier = makeNotifier<SavesActivityEvent>();

export const setSavesNotifier = notifier.set;
export const notifySavesActivity = notifier.notify;
