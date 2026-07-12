import { ipcRenderer } from 'electron';
import type { Game } from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<Game[]> => ipcRenderer.invoke('games:getAll'),
};
