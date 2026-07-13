import { ipcRenderer } from 'electron';
import type { IgdbGameDetail, IgdbSearchResult } from '../../shared/types';

export const igdbApi = {
  search: (query: string): Promise<IgdbSearchResult[]> => ipcRenderer.invoke('igdb:search', query),
  getById: (igdbId: number): Promise<IgdbGameDetail | null> =>
    ipcRenderer.invoke('igdb:getById', igdbId),
};
