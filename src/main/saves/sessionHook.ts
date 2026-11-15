import { appCtx } from '../db/v2/appDb';
import { listSaveGames } from '../db/v2/queries/saves';
import { isLudusaviAvailable } from './binary';
import { notifySavesActivity } from './notify';
import { backupGameToCloud } from './orchestrator';
import { isR2Configured } from './r2';
import type { GameId } from '../../shared/entityIds';

// El único disparador automático de toda la función: cerrar una sesión
// (PARTIDAS-GUARDADAS.md §10.2). Y solo hace BACKUP — restaurar no se
// automatiza jamás, ni siquiera aquí (§10bis.0).
//
// La asimetría es intencional: el backup es aditivo (si sale mal, se gasta
// espacio), el restore es destructivo (sobrescribe lo que hay en disco).

// Hay juegos que escriben la partida al salir; disparar en el instante del
// cierre la pillaría a medias.
const DELAY_MS = 8000;

// Los backups que esperan su margen de 8 s, con su temporizador: el cierre de
// la app los adelanta (flushPendingSaveBackups) en vez de perderlos (F-20).
const pending = new Map<GameId, ReturnType<typeof setTimeout>>();
// Los que ya están corriendo, para que el cierre pueda esperarlos.
const running = new Set<Promise<void>>();

const launch = (gameId: GameId): Promise<void> => {
  const task = runBackup(gameId);
  running.add(task);
  void task.finally(() => running.delete(task));
  return task;
};

export const scheduleSaveBackup = (gameId: GameId): void => {
  // Dos cierres seguidos del mismo juego (relanzar rápido) no encolan dos
  // backups: el que ya está esperando cubre los dos.
  if (pending.has(gameId)) return;

  // El aviso sale YA, no cuando arranca la subida: durante esos segundos de
  // margen el juego ya se ha cerrado y la ficha tiene que poder decir que
  // hay algo en camino, en vez de quedarse muda y luego cambiar sola.
  if (isLudusaviAvailable() && isR2Configured()) {
    notifySavesActivity({ gameId, phase: 'scheduled' });
  }

  const timer = setTimeout(() => {
    pending.delete(gameId);
    void launch(gameId);
  }, DELAY_MS);
  timer.unref?.();
  pending.set(gameId, timer);
};

/**
 * Para el cierre ordenado de la app (§10.6; lo llama la fase 4 desde
 * `before-quit`): lanza YA los backups que esperaban su margen, sin los 8 s, y
 * espera a que terminen esos y los que ya corrían, como mucho `timeoutMs`. No
 * lanza nunca: lo que no termine a tiempo se queda en la carpeta local de
 * ludusavi (o sin hacer) y lo recoge el siguiente backup del juego.
 *
 * El margen existe porque hay juegos que escriben la partida al salir; al
 * cerrar Afterplay el juego ya lleva cerrado lo que haya tardado el usuario,
 * así que adelantarlo es seguro salvo en el caso límite de cerrar la app en el
 * mismo segundo en que se cerró el juego.
 */
export const flushPendingSaveBackups = async (timeoutMs: number): Promise<void> => {
  const due = [...pending.entries()];
  pending.clear();
  for (const [gameId, timer] of due) {
    clearTimeout(timer);
    void launch(gameId);
  }
  const all = [...running];
  if (all.length === 0) return;
  console.log(`[saves] cierre: esperando ${all.length} backup(s) pendiente(s)`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.allSettled(all).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), Math.max(0, timeoutMs));
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) console.warn('[saves] cierre: no todos los backups terminaron a tiempo');
};

const runBackup = async (gameId: GameId): Promise<void> => {
  // Las dos puertas de §9.2. Sin credenciales de R2 esto ni se intenta: nada
  // de reintentos ni de errores por sesión — la función simplemente no
  // existe hasta que haya claves.
  if (!isLudusaviAvailable() || !isR2Configured()) return;

  try {
    const games = listSaveGames(appCtx());
    const game = games.find((candidate) => candidate.id === gameId);
    // Solo se sube lo que el usuario haya marcado, juego a juego (§10.5).
    if (!game?.saveBackupEnabled || !game.saveLudusaviName) {
      // Se avisa igualmente de que esto ha terminado: si no, una ficha que
      // recibió el 'scheduled' se quedaría con el spinner puesto para
      // siempre por un juego que ni siquiera estaba activado. foundFiles en
      // true a propósito: aquí no se ha buscado nada, así que no hay ningún
      // "no encontré tus partidas" que anunciar.
      notifySavesActivity({ gameId, phase: 'done', uploaded: 0, foundFiles: true });
      return;
    }

    notifySavesActivity({ gameId, phase: 'uploading' });
    // Sin candado: ludusavi y la subida van primero y la escritura del índice
    // es una transacción síncrona al final (orchestrator.ts). La exclusión
    // entre dos copias del mismo juego la da su cola en memoria.
    const result = await backupGameToCloud(game, games);
    if (result) {
      console.log(
        result.foundFiles
          ? `[saves] backup automatico de "${game.title}" (${result.uploaded} versiones nuevas)`
          : `[saves] backup automatico de "${game.title}": NO se encontro ningun archivo de partida`,
      );
    }
    notifySavesActivity({
      gameId,
      phase: 'done',
      uploaded: result?.uploaded ?? 0,
      foundFiles: result?.foundFiles ?? true,
    });
  } catch (error) {
    // Un fallo de backup no interrumpe nada: la partida sigue en el disco
    // del usuario y el próximo cierre de sesión reintenta.
    console.warn(`[saves] backup automatico fallido (juego ${gameId}):`, error);
    notifySavesActivity({ gameId, phase: 'failed', message: String(error) });
  }
};
