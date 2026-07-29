import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameRow,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';
import { generateCuriositiesInBackground } from '../curiosities/backfill';
import { createGameWithDetails } from '../db/queries/games/createGameWithDetails';
import { createPlannedGame } from '../db/queries/games/createPlannedGame';
import { deleteGame } from '../db/queries/games/deleteGame';
import { purgeGameSaves } from '../saves/orchestrator';
import { getGameById } from '../db/queries/games/getGameById';
import { getGames } from '../db/queries/games/getGames';
import { getPlannedGames } from '../db/queries/games/getPlannedGames';
import { promotePlannedGame } from '../db/queries/games/promotePlannedGame';
import { resetEndlessState } from '../db/queries/games/resetEndlessState';
import { updateGame } from '../db/queries/games/updateGame';
import { cacheImage } from '../images/cache';
import { openPathResult } from '../lib/openPath';

// Fire-and-forget a propósito: crear/editar un juego no debe esperar a que
// termine de bajar la imagen de un CDN externo, eso haría el guardado lento
// sin necesidad (la propia cacheImage() es idempotente, y si esto falla la
// imagen se sigue mostrando bien vía getImageSrc en el momento de pintarla).
const warmImageCache = (game: Pick<GameRow, 'coverUrl' | 'heroUrl'>): void => {
  if (game.coverUrl) {
    cacheImage(game.coverUrl, 'covers').catch((error) => {
      console.error('[images] fallo precacheando cover:', error);
    });
  }
  if (game.heroUrl) {
    cacheImage(game.heroUrl, 'heroes').catch((error) => {
      console.error('[images] fallo precacheando hero:', error);
    });
  }
};

export const registerGamesHandlers = (): void => {
  handleDb('games:getAll', async () => {
    return getGames();
  });

  handleDb('games:getById', async (_event, id: number) => {
    return getGameById(id);
  });

  handleDb('games:createWithDetails', async (_event, input: CreateGameWithDetailsInput) => {
    const game = await createGameWithDetails(input);
    warmImageCache(game);
    // Sus curiosidades del modo ambiente, de fondo (mismo espíritu que la
    // caché de imágenes): el guardado no espera a Wikipedia ni a la API.
    generateCuriositiesInBackground(game);
    return game;
  });

  // Sección Plan to Play (alta reducida + lista propia + paso a biblioteca).
  handleDb('games:getPlanned', async () => {
    return getPlannedGames();
  });

  handleDb('games:createPlanned', async (_event, input: CreatePlannedGameInput) => {
    const game = await createPlannedGame(input);
    warmImageCache(game);
    generateCuriositiesInBackground(game);
    return game;
  });

  handleDb('games:promote', async (_event, input: PromotePlannedGameInput) => {
    const game = await promotePlannedGame(input);
    warmImageCache(game);
    return game;
  });

  handleDb('games:update', async (_event, id: number, patch: UpdateGamePatch) => {
    const game = await updateGame(id, patch);
    if (game) warmImageCache(game);
    return game;
  });

  handleDb('games:delete', async (_event, id: number) => {
    // Antes de borrar la fila: sus copias de partida. La tabla save_backups
    // cuelga de games con ON DELETE CASCADE, así que el índice se va solo —
    // pero los objetos de R2 y la carpeta local NO, y sin esto se quedarían
    // ahí para siempre pagando espacio sin que nada los liste ni los pueda
    // borrar. Nunca lanza: no poder limpiar la nube no puede impedir borrar
    // un juego (PARTIDAS-GUARDADAS.md §9.1).
    await purgeGameSaves(id);
    return deleteGame(id);
  });

  // Conversión a endless: limpia desenlaces y marcadores de partida discreta
  // CONSERVANDO sesiones trackeadas y horas manuales (ver la query).
  handleDb('games:resetEndlessState', async (_event, id: number) => {
    return resetEndlessState(id);
  });

  // Botón Play y botón "abrir carpeta" — ni uno ni otro es acceso a datos
  // (ipcMain.handle directo, no handleDb). openPathResult comprueba que
  // exista ANTES de shell.openPath, así el mensaje ("no se encontró...") es
  // nuestro en español en vez del texto crudo del sistema operativo — y
  // sirve igual para un .exe que para un directorio (abrir carpetas en el
  // explorador es lo mismo para openPath que "ejecutar" un archivo).
  ipcMain.handle('games:launchExecutable', (_event, executablePath: string) =>
    openPathResult(executablePath),
  );

  ipcMain.handle('games:openInstallDirectory', (_event, installDirectory: string) =>
    openPathResult(installDirectory),
  );
};
