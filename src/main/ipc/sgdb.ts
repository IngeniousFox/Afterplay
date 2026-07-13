import { ipcMain } from 'electron';
import type { GetSgdbImagesInput } from '../../shared/types';
import { getSgdbImages } from '../sgdb/api';

export const registerSgdbHandlers = (): void => {
  ipcMain.handle('sgdb:getImages', async (_event, input: GetSgdbImagesInput) => {
    return getSgdbImages(input);
  });
};
