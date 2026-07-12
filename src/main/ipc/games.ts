import { ipcMain } from 'electron';
import { getGames } from '../db/queries/games/getGames';

export function registerGamesHandlers(): void {
  ipcMain.handle('games:getAll', async () => {
    return getGames();
  });
}
