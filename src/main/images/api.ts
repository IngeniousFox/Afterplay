import { pathToFileURL } from 'url';
import { cacheImage } from './cache';
import type { ImageCacheType } from './cache';

// Lo que de verdad necesita el renderer: algo que poner directo en un
// <img src>. Si el cacheo sale bien, una file:// a la ruta local; si falla
// (sin conexión, la imagen ya no existe en origen...) la URL remota tal
// cual, para que la imagen siga intentando cargar en vez de romper la UI.
export const getImageSrc = async (url: string, type: ImageCacheType): Promise<string> => {
  try {
    const localPath = await cacheImage(url, type);
    return pathToFileURL(localPath).toString();
  } catch (error) {
    console.error('[images] fallo cacheando, uso la URL remota:', error);
    return url;
  }
};
