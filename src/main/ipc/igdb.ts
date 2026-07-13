import { ipcMain } from 'electron';
import { getGameDetails, searchGames } from '../igdb/api';

export const registerIgdbHandlers = (): void => {
  ipcMain.handle('igdb:search', async (_event, query: string) => {
    return searchGames(query);
  });

  ipcMain.handle('igdb:getById', async (_event, igdbId: number) => {
    return getGameDetails(igdbId);
  });
};
