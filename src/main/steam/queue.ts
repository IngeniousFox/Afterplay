import { syncGameAchievements } from './syncAchievements';
import { hasSteamKey } from './api';
import { notifyAchievementsActivity } from './notify';

// La ÚNICA puerta por la que se sincronizan logros. Mismo patrón (y mismos
// motivos) que la cola de curiosidades: de uno en uno, con reserva por juego.
//
//   · Evita pagar dos veces el mismo juego. Una sync tarda un par de
//     segundos, y en ese rato el juego sigue apareciendo como "pendiente"
//     para cualquier otra pasada que arranque a la vez.
//   · Evita las ráfagas. La Steam Web API tiene su propio límite (100k
//     peticiones al día, pero con techo por minuto), y sincronizar 300 juegos
//     de golpe es justo cómo se cobra un 429. En serie no hace falta limitar
//     nada.
//
// A diferencia de las curiosidades, esto NO es "una vez en la vida": tus
// desbloqueos cambian cada vez que juegas, así que un juego puede volver a
// pasar por aquí muchas veces. Por eso la cola guarda solo ids y títulos, y
// quien encola decide a quién le toca.

export type PendingAchievementsGame = {
  id: number;
  title: string;
  steamAppId: number;
  // true solo en los refrescos EN VIVO (cerraste el juego, cambiaste su
  // ruta): son los únicos que avisan en pantalla. La pasada masiva no.
  notify?: boolean;
  // Para la fuente de emuladores (LOGROS.md §7): dos de sus formatos viven
  // JUNTO AL EXE, y el catálogo de Goldberg se escribe en la carpeta de
  // instalación. Nullables: sin ellos esa fuente simplemente mira menos sitios.
  executablePath: string | null;
  installDirectory: string | null;
};

const queue: PendingAchievementsGame[] = [];
const claimed = new Set<number>();
// Los que fallaron en la última pasada, con todo lo que hace falta para
// reintentarlos sin volver a consultar la lista. Sobrevive a que la cola se
// vacíe: es justo entonces cuando el botón de "reintentar" tiene sentido.
const failedGames = new Map<number, PendingAchievementsGame>();

let worker: Promise<void> | null = null;
let current: PendingAchievementsGame | null = null;
let processed = 0;
let failed = 0;
// "Para después de este" — mismo gesto que la cola de recaps: no corta a
// medias el juego en curso, pero suelta todo lo que quede detrás.
let stopRequested = false;

export const isAchievementsQueueRunning = (): boolean => worker !== null;

export const getFailedAchievementsCount = (): number => failedGames.size;

export const requestAchievementsStop = (): void => {
  if (worker) stopRequested = true;
};

// Reintentar SOLO los que fallaron. Devuelve cuántos se encolaron — 0 si no
// hay ninguno pendiente de reintento.
export const retryFailedAchievements = (): number => {
  const games = [...failedGames.values()];
  if (games.length === 0) return 0;
  failedGames.clear();
  enqueueAchievements(games);
  return games.length;
};

const emitProgress = (running: boolean): void => {
  notifyAchievementsActivity({
    kind: 'progress',
    running,
    done: processed,
    total: processed + queue.length + (current ? 1 : 0),
    failed,
    currentTitle: current?.title ?? null,
  });
};

const releaseQueue = (): void => {
  for (const game of queue) claimed.delete(game.id);
  queue.length = 0;
};

// Respiro entre juegos. La pasada completa son 300 y pico juegos, cada uno
// con varias transacciones de escritura, y el ciclo de sync con Turso corre
// cada minuto sobre ESE MISMO fichero: sin este hueco, la cola encadena
// escrituras durante minutos sin soltar nunca la DB y el sync se queda sin
// turno (o peor, compite con ella dentro del motor, que está en preview).
// 120 ms por juego son ~40 segundos de más en una pasada entera — barato a
// cambio de que la app siga respondiendo y el sync pueda entrar.
const BREATHE_MS = 120;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const drain = async (): Promise<void> => {
  while (queue.length > 0) {
    // La clave puede borrarse desde Ajustes a mitad de racha.
    if (!hasSteamKey() || stopRequested) {
      releaseQueue();
      break;
    }

    const next = queue.shift();
    if (!next) break;
    current = next;
    emitProgress(true);

    try {
      const result = await syncGameAchievements(current, current.notify === true);
      failedGames.delete(current.id);
      notifyAchievementsActivity({
        kind: 'synced',
        gameId: current.id,
        catalogCount: result.catalogCount,
        unlockedCount: result.unlockedCount,
      });
    } catch (error) {
      // Un juego que falla se recuerda para poder reintentar SOLO los
      // fallidos, sin repetir la pasada entera. Se guarda el título además
      // del id: cuando se reintenten, la lista ya no se vuelve a consultar.
      failed++;
      failedGames.set(current.id, current);
      console.error(`[steam] fallo sincronizando logros de "${current.title}":`, error);
    }

    claimed.delete(current.id);
    current = null;
    processed++;

    // Soltar el hilo entre juegos (ver BREATHE_MS).
    if (queue.length > 0) await sleep(BREATHE_MS);
  }
};

// Encola los que aún no estén reservados y arranca el worker si estaba
// parado. Devuelve enseguida: la sincronización va por su cuenta.
export const enqueueAchievements = (games: PendingAchievementsGame[]): void => {
  if (!hasSteamKey()) return;

  let added = false;
  for (const game of games) {
    if (claimed.has(game.id)) continue;
    claimed.add(game.id);
    queue.push(game);
    added = true;
  }

  if (!added || worker) return;

  processed = 0;
  failed = 0;
  stopRequested = false;
  worker = drain()
    .catch((error) => {
      console.error('[steam] la cola de logros se detuvo por un error inesperado:', error);
    })
    .finally(() => {
      worker = null;
      stopRequested = false;
      emitProgress(false);
    });
};
