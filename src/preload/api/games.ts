import { ipcRenderer } from 'electron';
import type {
  CreateGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  UpdateGamePatch,
} from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getAll'),
  getById: (id: number): Promise<GameDetail | null> => ipcRenderer.invoke('games:getById', id),
  create: (input: CreateGameInput): Promise<GameRow> => ipcRenderer.invoke('games:create', input),
  update: (id: number, patch: UpdateGamePatch): Promise<GameRow | null> =>
    ipcRenderer.invoke('games:update', id, patch),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('games:delete', id),
};
