import { ipcRenderer } from 'electron';
import type { GameListItem } from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getAll'),
};
