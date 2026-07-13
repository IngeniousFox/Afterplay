import { ipcMain } from 'electron';
import type { CreateGameInput, GameRow, UpdateGamePatch } from '../../shared/types';
import { createGame } from '../db/queries/games/createGame';
import { deleteGame } from '../db/queries/games/deleteGame';
import { getGameById } from '../db/queries/games/getGameById';
import { getGames } from '../db/queries/games/getGames';
import { updateGame } from '../db/queries/games/updateGame';
import { cacheImage } from '../images/cache';

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
  ipcMain.handle('games:getAll', async () => {
    return getGames();
  });

  ipcMain.handle('games:getById', async (_event, id: number) => {
    return getGameById(id);
  });

  ipcMain.handle('games:create', async (_event, input: CreateGameInput) => {
    const game = await createGame(input);
    warmImageCache(game);
    return game;
  });

  ipcMain.handle('games:update', async (_event, id: number, patch: UpdateGamePatch) => {
    const game = await updateGame(id, patch);
    if (game) warmImageCache(game);
    return game;
  });

  ipcMain.handle('games:delete', async (_event, id: number) => {
    return deleteGame(id);
  });
};
