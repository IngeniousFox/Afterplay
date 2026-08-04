import type { PendingCuriositiesGame } from '../db/queries/curiosities/getPendingCuriositiesGames';
import { createClaimQueue } from '../lib/claimQueue';
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
//     estaba generando justo en ese momento y lo pedía otra vez. La reserva
//     de la cola lo impide por construcción.
//   · Las ráfagas. Cada generación toca IGDB (que admite 4 peticiones por
//     segundo), Wikipedia y la API de Anthropic. Añadir varios juegos seguidos
//     disparaba todas esas llamadas a la vez y se comía 429 de rebote. En
//     serie no hace falta limitar nada por servicio.
//
// Ir de uno en uno no cuesta nada: esto corre una vez por juego EN LA VIDA y
// el juego ya está guardado — sus curiosidades llegan cuando lleguen.
//
// La mecánica de cola (serie, reservas, rachas, puerta por clave) vive en
// lib/claimQueue, compartida con las colas de recaps y de logros y clavada
// por el test de src/main/__tests__/queues.test.ts. Aquí solo queda lo que es
// de ESTE dominio: qué se genera, qué eventos se emiten y cómo se loga.
const queue = createClaimQueue<PendingCuriositiesGame>({
  keyOf: (game) => game.id,
  // La clave puede borrarse desde Ajustes a mitad de racha: se suelta lo que
  // quede para que un "Generate" posterior lo vuelva a encolar limpio.
  canRun: () => Boolean(process.env.ANTHROPIC_API_KEY),
  process: async (game) => {
    await generateCuriositiesForGame(game);
    notifyCuriositiesActivity({ kind: 'generated', gameId: game.id });
  },
  onProgress: (progress) => {
    notifyCuriositiesActivity({
      kind: 'progress',
      running: progress.running,
      done: progress.done,
      total: progress.total,
      failed: progress.failed,
      currentTitle: progress.current?.title ?? null,
    });
  },
  // Un juego que falla (red, Wikipedia caída, 429) se queda sin marcar y por
  // tanto pendiente: la siguiente pasada lo recoge. No tumba al resto.
  onItemError: (game, error) => {
    console.error(`[curiosities] fallo generando "${game.title}":`, error);
  },
  onWorkerError: (error) => {
    console.error('[curiosities] la cola se detuvo por un error inesperado:', error);
  },
});

export const isCuriositiesQueueRunning = (): boolean => queue.isRunning();

// Encola los que aún no estén reservados y arranca el worker si estaba parado.
// Devuelve enseguida: la generación va por su cuenta.
export const enqueueCuriosities = (games: PendingCuriositiesGame[]): void => {
  queue.enqueue(games);
};
