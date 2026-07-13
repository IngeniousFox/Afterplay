import { ipcRenderer } from 'electron';
import type { ImageCacheType } from '../../shared/types';

export const imagesApi = {
  // Devuelve algo listo para <img src>: una file:// local si se pudo
  // cachear, o la URL remota tal cual si el cacheo falla.
  getSrc: (url: string, type: ImageCacheType): Promise<string> =>
    ipcRenderer.invoke('images:getSrc', url, type),
};
