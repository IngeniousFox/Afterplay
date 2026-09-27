import { ipcRenderer } from 'electron';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PlannedGameExtras,
  PlannedGameListItem,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';

export const gamesApi = {
  getAll: (): Promise<GameListItem[]> => ipcRenderer.invoke('games:getAll'),
  // La lista del Plan viaja en DOS canales (la medida que lo justifica esta
  // en ipc/games.ts): getPlanned es el escueto que pagan todos sus
  // consumidores en cada 'games:changed', y getPlannedExtras lleva los
  // campos que SOLO mira la pantalla del Plan (sinopsis, porque, fecha
  // completa, notas, etiquetas, hero) — la pantalla los junta por id con
  // usePlannedGamesWithExtras.
  getPlanned: (): Promise<PlannedGameListItem[]> => ipcRenderer.invoke('games:getPlanned'),
  getPlannedExtras: (): Promise<PlannedGameExtras[]> =>
    ipcRenderer.invoke('games:getPlannedExtras'),
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
  moveToPlan: (gameId: number): Promise<GameRow> => ipcRenderer.invoke('games:moveToPlan', gameId),
  getById: (id: number): Promise<GameDetail | null> => ipcRenderer.invoke('games:getById', id),
  createWithDetails: (input: CreateGameWithDetailsInput): Promise<GameRow> =>
    ipcRenderer.invoke('games:createWithDetails', input),
  update: (id: number, patch: UpdateGamePatch): Promise<GameRow | null> =>
    ipcRenderer.invoke('games:update', id, patch),
  setSteamAppId: (id: number, appId: number): Promise<GameRow | null> =>
    ipcRenderer.invoke('games:setSteamAppId', id, appId),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('games:delete', id),
  resetEndlessState: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('games:resetEndlessState', id),
  launchExecutable: (executablePath: string): Promise<LaunchExecutableResult> =>
    ipcRenderer.invoke('games:launchExecutable', executablePath),
  openInstallDirectory: (installDirectory: string): Promise<LaunchExecutableResult> =>
    ipcRenderer.invoke('games:openInstallDirectory', installDirectory),
};
