import { ipcRenderer } from 'electron';
import type {
  GameRatings,
  IgdbGameDetail,
  IgdbSearchResult,
  RatingsRefreshSummary,
  RatingsStatus,
} from '../../shared/types';

export const igdbApi = {
  search: (query: string): Promise<IgdbSearchResult[]> => ipcRenderer.invoke('igdb:search', query),
  getById: (igdbId: number): Promise<IgdbGameDetail | null> =>
    ipcRenderer.invoke('igdb:getById', igdbId),
  // Vuelve a preguntar por un juego YA dado de alta y guarda sus notas
  // nuevas. null = el juego ya no está en el catálogo de IGDB; lo que había
  // se conserva.
  refreshRatings: (gameId: number): Promise<GameRatings | null> =>
    ipcRenderer.invoke('igdb:refreshRatings', gameId),
  // El bloque Ratings de Ajustes: estado (cuántos tienen notas) y el
  // "Refresh all" por lotes de toda la biblioteca.
  ratingsStatus: (): Promise<RatingsStatus> => ipcRenderer.invoke('igdb:ratingsStatus'),
  refreshAllRatings: (): Promise<RatingsRefreshSummary> =>
    ipcRenderer.invoke('igdb:refreshAllRatings'),
};
