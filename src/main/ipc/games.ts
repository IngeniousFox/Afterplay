import { ipcMain } from 'electron';
import type { CreateGameInput, UpdateGamePatch } from '../../shared/types';
import { createGame } from '../db/queries/games/createGame';
import { deleteGame } from '../db/queries/games/deleteGame';
import { getGameById } from '../db/queries/games/getGameById';
import { getGames } from '../db/queries/games/getGames';
import { updateGame } from '../db/queries/games/updateGame';

export const registerGamesHandlers = (): void => {
  ipcMain.handle('games:getAll', async () => {
    return getGames();
  });

  ipcMain.handle('games:getById', async (_event, id: number) => {
    return getGameById(id);
  });

  ipcMain.handle('games:create', async (_event, input: CreateGameInput) => {
    return createGame(input);
  });

  ipcMain.handle('games:update', async (_event, id: number, patch: UpdateGamePatch) => {
    return updateGame(id, patch);
  });

  ipcMain.handle('games:delete', async (_event, id: number) => {
    return deleteGame(id);
  });
};
