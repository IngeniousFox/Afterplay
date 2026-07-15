import { existsSync } from 'fs';
import { ipcMain, shell } from 'electron';
import { handleDb } from './dbHandle';
import type {
  CreateGameInput,
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameRow,
  LaunchExecutableResult,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';
import { createGame } from '../db/queries/games/createGame';
import { createGameWithDetails } from '../db/queries/games/createGameWithDetails';
import { createPlannedGame } from '../db/queries/games/createPlannedGame';
import { deleteGame } from '../db/queries/games/deleteGame';
import { getGameById } from '../db/queries/games/getGameById';
import { getGames } from '../db/queries/games/getGames';
import { getPlannedGames } from '../db/queries/games/getPlannedGames';
import { promotePlannedGame } from '../db/queries/games/promotePlannedGame';
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
  handleDb('games:getAll', async () => {
    return getGames();
  });

  handleDb('games:getById', async (_event, id: number) => {
    return getGameById(id);
  });

  handleDb('games:create', async (_event, input: CreateGameInput) => {
    const game = await createGame(input);
    warmImageCache(game);
    return game;
  });

  handleDb('games:createWithDetails', async (_event, input: CreateGameWithDetailsInput) => {
    const game = await createGameWithDetails(input);
    warmImageCache(game);
    return game;
  });

  // Sección Plan to Play (alta reducida + lista propia + paso a biblioteca).
  handleDb('games:getPlanned', async () => {
    return getPlannedGames();
  });

  handleDb('games:createPlanned', async (_event, input: CreatePlannedGameInput) => {
    const game = await createPlannedGame(input);
    warmImageCache(game);
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
    return deleteGame(id);
  });

  // Botón Play — no es acceso a datos (ipcMain.handle directo, no handleDb).
  // Comprobación de existencia propia ANTES de shell.openPath: así el
  // mensaje ("no se encontró el ejecutable") es nuestro y está en español,
  // en vez del texto crudo que devuelva el sistema operativo.
  ipcMain.handle(
    'games:launchExecutable',
    async (_event, executablePath: string): Promise<LaunchExecutableResult> => {
      if (!existsSync(executablePath)) {
        return { ok: false, reason: 'missing' };
      }
      const error = await shell.openPath(executablePath);
      if (error) {
        return { ok: false, reason: 'error', message: error };
      }
      return { ok: true };
    },
  );
};
