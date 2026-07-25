import { withDbAccess } from '../db';
import { getSaveGames } from '../db/queries/saves/getSaveGames';
import { isLudusaviAvailable } from './binary';
import { notifySavesActivity } from './notify';
import { backupGameToCloud } from './orchestrator';
import { isR2Configured } from './r2';

// El único disparador automático de toda la función: cerrar una sesión
// (PARTIDAS-GUARDADAS.md §10.2). Y solo hace BACKUP — restaurar no se
// automatiza jamás, ni siquiera aquí (§10bis.0).
//
// La asimetría es intencional: el backup es aditivo (si sale mal, se gasta
// espacio), el restore es destructivo (sobrescribe lo que hay en disco).

// Hay juegos que escriben la partida al salir; disparar en el instante del
// cierre la pillaría a medias.
const DELAY_MS = 8000;

const pending = new Set<number>();

export const scheduleSaveBackup = (gameId: number): void => {
  // Dos cierres seguidos del mismo juego (relanzar rápido) no encolan dos
  // backups: el que ya está esperando cubre los dos.
  if (pending.has(gameId)) return;
  pending.add(gameId);

  // El aviso sale YA, no cuando arranca la subida: durante esos segundos de
  // margen el juego ya se ha cerrado y la ficha tiene que poder decir que
  // hay algo en camino, en vez de quedarse muda y luego cambiar sola.
  if (isLudusaviAvailable() && isR2Configured()) {
    notifySavesActivity({ gameId, phase: 'scheduled' });
  }

  setTimeout(() => {
    pending.delete(gameId);
    void runBackup(gameId);
  }, DELAY_MS).unref?.();
};

const runBackup = async (gameId: number): Promise<void> => {
  // Las dos puertas de §9.2. Sin credenciales de R2 esto ni se intenta: nada
  // de reintentos ni de errores por sesión — la función simplemente no
  // existe hasta que haya claves.
  if (!isLudusaviAvailable() || !isR2Configured()) return;

  try {
    const games = await withDbAccess(() => getSaveGames());
    const game = games.find((candidate) => candidate.id === gameId);
    // Solo se sube lo que el usuario haya marcado, juego a juego (§10.5).
    if (!game?.saveBackupEnabled || !game.saveLudusaviName) {
      // Se avisa igualmente de que esto ha terminado: si no, una ficha que
      // recibió el 'scheduled' se quedaría con el spinner puesto para
      // siempre por un juego que ni siquiera estaba activado.
      notifySavesActivity({ gameId, phase: 'done', uploaded: 0 });
      return;
    }

    notifySavesActivity({ gameId, phase: 'uploading' });
    // TODO EL trabajo con la DB dentro de withDbAccess, no solo la lectura de
    // arriba. backupGameToCloud escribe en save_backups, y hacerlo por fuera
    // del candado es exactamente lo que rompe cuando el ciclo de sync (cada
    // 60s) decide reconectar con Turso a mitad: la conexión se cierra debajo
    // y la escritura revienta con "connection is not open". El handler
    // manual ya entraba por handleDb; este camino, el automático, se había
    // quedado sin esa protección.
    //
    // Sí, el candado se mantiene durante la subida a R2. Es el precio: un
    // swap que coincida se pospone al siguiente ciclo (waitForDbIdle tiene su
    // propio timeout), que es infinitamente preferible a perder el backup.
    const result = await withDbAccess(() => backupGameToCloud(game, games));
    if (result) {
      console.log(
        `[saves] backup automatico de "${game.title}" (${result.uploaded} versiones nuevas)`,
      );
    }
    notifySavesActivity({ gameId, phase: 'done', uploaded: result?.uploaded ?? 0 });
  } catch (error) {
    // Un fallo de backup no interrumpe nada: la partida sigue en el disco
    // del usuario y el próximo cierre de sesión reintenta.
    console.warn(`[saves] backup automatico fallido (juego ${gameId}):`, error);
    notifySavesActivity({ gameId, phase: 'failed', message: String(error) });
  }
};
