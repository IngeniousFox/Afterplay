import { ipcRenderer } from 'electron';
import type {
  CreateGameInput,
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getAll'),
  getPlanned: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getPlanned'),
  createPlanned: (input: CreatePlannedGameInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:createPlanned', input),
  promote: (input: PromotePlannedGameInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:promote', input),
  getById: (id: number): Promise<GameDetail | null> => ipcRenderer.invoke('games:getById', id),
  create: (input: CreateGameInput): Promise<GameRow> => ipcRenderer.invoke('games:create', input),
  createWithDetails: (input: CreateGameWithDetailsInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:createWithDetails', input),
  update: (id: number, patch: UpdateGamePatch): Promise<GameRow | null> =>
    ipcRenderer.invoke('games:update', id, patch),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('games:delete', id),
  launchExecutable: (executablePath: string): Promise<LaunchExecutableResult> =>
    ipcRenderer.invoke('games:launchExecutable', executablePath),
};
