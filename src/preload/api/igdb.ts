import { ipcRenderer } from 'electron';
import type {
  CollectionGame,
  GameRatings,
  IgdbGameDetail,
  IgdbSearchResult,
} from '../../shared/types';

export const igdbApi = {
  search: (query: string): Promise<IgdbSearchResult[]> => ipcRenderer.invoke('igdb:search', query),
  getById: (igdbId: number): Promise<IgdbGameDetail | null> =>
    ipcRenderer.invoke('igdb:getById', igdbId),
  // Vuelve a preguntar por un juego YA dado de alta y guarda sus notas
  // nuevas. null = el juego ya no está en el catálogo de IGDB; lo que había
  // se conserva.
  // De paso guarda todo lo demas que el detalle ya trae en la misma
  // respuesta (sinopsis, sagas, fecha completa), aunque solo devuelva las
  // notas. El refresco por LOTES de toda la biblioteca vive en api.external.
  refreshRatings: (gameId: number): Promise<GameRatings | null> =>
    ipcRenderer.invoke('igdb:refreshRatings', gameId),
  // Los juegos de una saga, para el carrusel de la ficha.
  collectionGames: (collectionIds: number[]): Promise<CollectionGame[]> =>
    ipcRenderer.invoke('igdb:collectionGames', collectionIds),
};
