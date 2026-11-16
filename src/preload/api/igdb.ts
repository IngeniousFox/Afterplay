import { invoke } from '../ipc';
import type {
  CollectionGame,
  IgdbGameDetail,
  IgdbSearchResult,
  SteamSearchResult,
} from '../../shared/types';

export const igdbApi = {
  search: (query: string): Promise<IgdbSearchResult[]> => invoke('igdb:search', query),
  getById: (igdbId: number): Promise<IgdbGameDetail | null> => invoke('igdb:getById', igdbId),
  // El respaldo cuando IGDB no encuentra nada: la tienda de Steam.
  searchSteam: (query: string): Promise<SteamSearchResult[]> => invoke('igdb:searchSteam', query),
  // El refresco de las notas de un juego vive en api.external.refreshRatings:
  // dejó de ser solo de IGDB cuando la card estreno el tile de Steam.
  // Los juegos de una saga, para el carrusel de la ficha.
  collectionGames: (collectionIds: number[]): Promise<CollectionGame[]> =>
    invoke('igdb:collectionGames', collectionIds),
};
