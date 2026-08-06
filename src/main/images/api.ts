import axios from 'axios';
import { cacheImage } from './cache';
import type { ImageCacheType } from './cache';
import { toImageProtocolUrl } from './protocol';
import { normalizeSteamCommunityImageUrl } from './steamCdn';

// URLs ya avisadas en esta sesión. Los logros de un mismo juego COMPARTEN la
// URL del icono cuando ninguno tiene uno (todos apuntan al directorio del
// appid, ver steamCdn.ts), así que sin esto abrir esa ficha soltaba treinta y
// cuatro líneas idénticas de golpe — y un aviso repetido así deja de leerse.
const warned = new Set<string>();

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
    // Una LÍNEA, no el objeto de axios entero: volcarlo imprimía cientos de
    // líneas por imagen (cabeceras, sockets, la petición completa) y una
    // tanda de iconos rotos ahogaba la consola hasta hacerla inútil.
    if (!warned.has(url)) {
      warned.add(url);
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const reason = status ?? (error instanceof Error ? error.message : 'error desconocido');
      console.warn(`[images] sin cachear (${reason}), uso la URL remota: ${url}`);
    }
    // La normalizada: si la vieja de Steam ya no existe, devolverla haría que
    // el <img> reintentara el 404 desde el renderer.
    return normalizeSteamCommunityImageUrl(url);
  }
};
