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

const pending = new Set<GameId>();

export const scheduleSaveBackup = (gameId: GameId): void => {
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
