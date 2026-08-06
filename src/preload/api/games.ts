import { ipcRenderer } from 'electron';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PlannedGameItem,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getAll'),
  // PlannedGameItem y no GameListItem: la pantalla del Plan necesita mas de
  // cada juego (sinopsis, el porque de haberlo planeado, el pin, la fecha
  // completa, las notas). Es un superconjunto, asi que sus otros tres
  // consumidores siguen leyendo exactamente lo mismo que antes.
  getPlanned: (): Promise<PlannedGameItem[]> => ipcRenderer.invoke('games:getPlanned'),
  // "Up next" (PLAN-TO-PLAY.md 2.2) — fijar o soltar un planeado.
  setPlanPinned: (id: number, pinned: boolean): Promise<boolean> =>
    ipcRenderer.invoke('games:setPlanPinned', id, pinned),
  // Reordenar Up next arrastrando — los ids fijados, en su orden nuevo.
  reorderUpNext: (orderedIds: number[]): Promise<boolean> =>
    ipcRenderer.invoke('games:reorderUpNext', orderedIds),
  createPlanned: (input: CreatePlannedGameInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:createPlanned', input),
  promote: (input: PromotePlannedGameInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:promote', input),
  getById: (id: number): Promise<GameDetail | null> => ipcRenderer.invoke('games:getById', id),
  createWithDetails: (input: CreateGameWithDetailsInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:createWithDetails', input),
  update: (id: number, patch: UpdateGamePatch): Promise<GameRow | null> =>
    ipcRenderer.invoke('games:update', id, patch),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('games:delete', id),
  resetEndlessState: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('games:resetEndlessState', id),
  launchExecutable: (executablePath: string): Promise<LaunchExecutableResult> =>
    ipcRenderer.invoke('games:launchExecutable', executablePath),
  openInstallDirectory: (installDirectory: string): Promise<LaunchExecutableResult> =>
    ipcRenderer.invoke('games:openInstallDirectory', installDirectory),
};
