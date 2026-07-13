import { ipcMain } from 'electron';
import type { ImageCacheType } from '../../shared/types';
import { getImageSrc } from '../images/api';

export const registerImagesHandlers = (): void => {
  ipcMain.handle('images:getSrc', async (_event, url: string, type: ImageCacheType) => {
    return getImageSrc(url, type);
  });
};
