import { createClaimQueue } from '../lib/claimQueue';
import { syncGameAchievements } from './syncAchievements';
import { hasSteamKey } from './api';
import { notifyAchievementsActivity } from './notify';

// La ÚNICA puerta por la que se sincronizan logros — la misma cola serial con
// reserva que curiosidades y recaps (lib/claimQueue, clavada por el test de
// src/main/__tests__/queues.test.ts) y por los mismos motivos:
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
  // Para el fondo del aviso flotante — el mismo hero que usa el aviso de
  // sesión cerrada.
  heroUrl: string | null;
};

// Los que fallaron en la última pasada, con todo lo que hace falta para
// reintentarlos sin volver a consultar la lista. Sobrevive a que la cola se
// vacíe: es justo entonces cuando el botón de "reintentar" tiene sentido.
const failedGames = new Map<number, PendingAchievementsGame>();

const queue = createClaimQueue<PendingAchievementsGame>({
  keyOf: (game) => game.id,
  canRun: () => hasSteamKey(),
  process: async (game) => {
    const result = await syncGameAchievements(game, game.notify === true);
    failedGames.delete(game.id);
    notifyAchievementsActivity({
      kind: 'synced',
      gameId: game.id,
      catalogCount: result.catalogCount,
      unlockedCount: result.unlockedCount,
    });
  },
  onProgress: (progress) => {
    notifyAchievementsActivity({
      kind: 'progress',
      running: progress.running,
      done: progress.done,
      total: progress.total,
      failed: progress.failed,
      currentTitle: progress.current?.title ?? null,
    });
  },
  // Un juego que falla se recuerda para poder reintentar SOLO los fallidos,
  // sin repetir la pasada entera. Se guarda el título además del id: cuando
  // se reintenten, la lista ya no se vuelve a consultar.
  onItemError: (game, error) => {
    failedGames.set(game.id, game);
    console.error(`[steam] fallo sincronizando logros de "${game.title}":`, error);
  },
  onWorkerError: (error) => {
    console.error('[steam] la cola de logros se detuvo por un error inesperado:', error);
  },
  // Respiro entre juegos. La pasada completa son 300 y pico juegos, cada uno
  // con varias transacciones de escritura, y el ciclo de sync con Turso corre
  // cada minuto sobre ESE MISMO fichero: sin este hueco, la cola encadena
  // escrituras durante minutos sin soltar nunca la DB y el sync se queda sin
  // turno (o peor, compite con ella dentro del motor, que está en preview).
  // 120 ms por juego son ~40 segundos de más en una pasada entera — barato a
  // cambio de que la app siga respondiendo y el sync pueda entrar.
  breatheMs: 120,
});

export const isAchievementsQueueRunning = (): boolean => queue.isRunning();

export const getFailedAchievementsCount = (): number => failedGames.size;

// "Para después de este" — no corta a medias el juego en curso, pero suelta
// todo lo que quede detrás.
export const requestAchievementsStop = (): void => {
  queue.requestStop();
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

// Encola los que aún no estén reservados y arranca el worker si estaba
// parado. Devuelve enseguida: la sincronización va por su cuenta.
export const enqueueAchievements = (games: PendingAchievementsGame[]): void => {
  queue.enqueue(games);
};
