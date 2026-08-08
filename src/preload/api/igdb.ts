import { ipcRenderer } from 'electron';
import type { CollectionGame, IgdbGameDetail, IgdbSearchResult } from '../../shared/types';

export const igdbApi = {
  search: (query: string): Promise<IgdbSearchResult[]> => ipcRenderer.invoke('igdb:search', query),
  getById: (igdbId: number): Promise<IgdbGameDetail | null> =>
    ipcRenderer.invoke('igdb:getById', igdbId),
  // El refresco de las notas de un juego vive en api.external.refreshRatings:
  // dejó de ser solo de IGDB cuando la card estreno el tile de Steam.
  // Los juegos de una saga, para el carrusel de la ficha.
  collectionGames: (collectionIds: number[]): Promise<CollectionGame[]> =>
    ipcRenderer.invoke('igdb:collectionGames', collectionIds),
};
