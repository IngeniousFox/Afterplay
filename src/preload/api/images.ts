import { invoke, subscribe } from '../ipc';
import type { ImageCacheType, ImageCacheUsage, ImageRedownloadEvent } from '../../shared/types';

export const imagesApi = {
  // Devuelve algo listo para <img src>: una URL afterplay-image:// a la
  // copia local si se pudo cachear, o la URL remota tal cual si el cacheo
  // falla.
  getSrc: (url: string, type: ImageCacheType): Promise<string> =>
    invoke('images:getSrc', url, type),
  // Cuánto ocupa la caché en disco y cuánto de eso sobra.
  getUsage: (): Promise<ImageCacheUsage> => invoke('images:getUsage'),
  // Borra lo prescindible; devuelve lo liberado y cómo queda la caché.
  cleanUnused: (): Promise<{ files: number; bytes: number; usage: ImageCacheUsage }> =>
    invoke('images:cleanUnused'),
  // Arranca la redescarga y devuelve cuántas imágenes entraron (0 = ya había
  // una en marcha). El progreso llega por onRedownloadActivity.
  redownload: (): Promise<number> => invoke('images:redownload'),
  // Mismo contrato que el resto de canales de actividad: devuelve la función
  // de limpieza, para encajar con el cleanup de useEffect.
  onRedownloadActivity: (callback: (event: ImageRedownloadEvent) => void): (() => void) =>
    subscribe('images:activity', callback),
};
