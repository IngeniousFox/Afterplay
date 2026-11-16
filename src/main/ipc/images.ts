import { handle } from './contractHandlers';
import type { ImageCacheType } from '../../shared/types';
import { getImageSrc } from '../images/api';
import { cleanUnusedImages, getImageCacheUsage, redownloadUsedImages } from '../images/maintenance';

export const registerImagesHandlers = (): void => {
  handle('images:getSrc', async (_event, url: string, type: ImageCacheType) => {
    return getImageSrc(url, type);
  });

  // Mantenimiento de la caché local (Ajustes → Images). Nada de esto toca la
  // base de datos: son ficheros de userData, copias de cosas que están en
  // internet.
  handle('images:getUsage', () => getImageCacheUsage());

  handle('images:cleanUnused', () => cleanUnusedImages());

  // Devuelve cuántas entraron en la pasada (0 = ya había una en marcha); el
  // progreso viaja por 'images:activity'.
  handle('images:redownload', () => redownloadUsedImages());
};
