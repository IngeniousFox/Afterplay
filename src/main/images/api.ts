import { cacheImage } from './cache';
import type { ImageCacheType } from './cache';
import { toImageProtocolUrl } from './protocol';

// Lo que de verdad necesita el renderer: algo que poner directo en un
// <img src>. Si el cacheo sale bien, una afterplay-image:// a la ruta local
// (NO file:// — Chromium bloquea que una página http/https, como la del
// renderer en dev, cargue file:// directamente; ver protocol.ts). Si falla
// el cacheo (sin conexión, la imagen ya no existe en origen...) la URL
// remota tal cual, para que la imagen siga intentando cargar en vez de
// romper la UI.
export const getImageSrc = async (url: string, type: ImageCacheType): Promise<string> => {
  try {
    const localPath = await cacheImage(url, type);
    return toImageProtocolUrl(localPath);
  } catch (error) {
    console.error('[images] fallo cacheando, uso la URL remota:', error);
    return url;
  }
};
