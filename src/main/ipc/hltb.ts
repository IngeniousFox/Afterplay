import { ipcMain } from 'electron';
import { getHltbTimes } from '../hltb/api';

export const registerHltbHandlers = (): void => {
  ipcMain.handle('hltb:getTimes', async (_event, title: string, releaseYear: number | null) => {
    return getHltbTimes(title, releaseYear);
  });
};
