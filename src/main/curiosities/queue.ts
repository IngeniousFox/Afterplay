import type { PendingCuriositiesGame } from '../db/queries/curiosities/getPendingCuriositiesGames';
import { generateCuriositiesForGame } from './generate';
import { notifyCuriositiesActivity } from './notify';

// La ÚNICA puerta por la que se generan curiosidades. Los caminos que existen
// (alta directa en biblioteca, paso de Plan to Play a biblioteca, y la pasada
// de Ajustes) encolan aquí en vez de generar por su cuenta, y esto lo
// resuelve de uno en uno.
//
// Por qué una cola y no lanzar y ya:
//   · Pagar dos veces el mismo juego. Una generación tarda entre medio minuto
//     y un minuto, y en todo ese rato curiositiesGeneratedAt sigue a null —
//     así que la pasada de Ajustes veía como "pendiente" un juego que se
//     estaba generando justo en ese momento y lo pedía otra vez. El conjunto
//     `claimed` lo impide por construcción: un juego reservado no vuelve a
//     entrar hasta que termina.
//   · Las ráfagas. Cada generación toca IGDB (que admite 4 peticiones por
//     segundo), Wikipedia y la API de Anthropic. Añadir varios juegos seguidos
//     disparaba todas esas llamadas a la vez y se comía 429 de rebote. En
//     serie no hace falta limitar nada por servicio.
//
// Ir de uno en uno no cuesta nada: esto corre una vez por juego EN LA VIDA y
// el juego ya está guardado — sus curiosidades llegan cuando lleguen.

const queue: PendingCuriositiesGame[] = [];
// Encolados o generándose ahora mismo. Es lo que hace que encolar dos veces
// el mismo juego sea inofensivo, venga de donde venga.
const claimed = new Set<number>();

let worker: Promise<void> | null = null;
let current: PendingCuriositiesGame | null = null;
// Contadores de la racha en curso (desde que la cola arranca vacía hasta que
// se vuelve a vaciar), para el progreso de la tarjeta de Ajustes. El total se
// calcula al vuelo porque puede crecer a mitad: dar de alta un juego mientras
// la pasada corre lo añade a la misma racha.
let processed = 0;
let failed = 0;

export const isCuriositiesQueueRunning = (): boolean => worker !== null;

const emitProgress = (running: boolean): void => {
  notifyCuriositiesActivity({
    kind: 'progress',
    running,
    done: processed,
    total: processed + queue.length + (current ? 1 : 0),
    failed,
    currentTitle: current?.title ?? null,
  });
};

const drain = async (): Promise<void> => {
  while (queue.length > 0) {
    // La clave puede borrarse desde Ajustes a mitad de racha: se suelta lo que
    // quede para que un "Generate" posterior lo vuelva a encolar limpio.
    if (!process.env.ANTHROPIC_API_KEY) {
      for (const game of queue) claimed.delete(game.id);
      queue.length = 0;
      break;
    }

    const next = queue.shift();
    if (!next) break;
    current = next;
    emitProgress(true);

    try {
      await generateCuriositiesForGame(current);
      notifyCuriositiesActivity({ kind: 'generated', gameId: current.id });
    } catch (error) {
      // Un juego que falla (red, Wikipedia caída, 429) se queda sin marcar y
      // por tanto pendiente: la siguiente pasada lo recoge. No tumba al resto.
      failed++;
      console.error(`[curiosities] fallo generando "${current.title}":`, error);
    }

    claimed.delete(current.id);
    current = null;
    processed++;
  }
};

// Encola los que aún no estén reservados y arranca el worker si estaba parado.
// Devuelve enseguida: la generación va por su cuenta.
export const enqueueCuriosities = (games: PendingCuriositiesGame[]): void => {
  if (!process.env.ANTHROPIC_API_KEY) return;

  let added = false;
  for (const game of games) {
    if (claimed.has(game.id)) continue;
    claimed.add(game.id);
    queue.push(game);
    added = true;
  }

  if (!added || worker) return;

  // Racha nueva: el progreso cuenta desde cero. Si el worker ya estaba en
  // marcha esto no se toca — lo encolado se suma a la racha actual y el total
  // sube solo.
  processed = 0;
  failed = 0;
  worker = drain()
    .catch((error) => {
      console.error('[curiosities] la cola se detuvo por un error inesperado:', error);
    })
    .finally(() => {
      worker = null;
      emitProgress(false);
    });
};
