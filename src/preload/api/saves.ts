import { ipcRenderer } from 'electron';
import type {
  RestoreRequestInput,
  RestoreResult,
  SavesActivityEvent,
  SavesBackupResult,
  SavesGameState,
  SavesScanEntry,
  SavesStatus,
} from '../../main/saves/contracts';

export const savesApi = {
  getStatus: (): Promise<SavesStatus> => ipcRenderer.invoke('saves:getStatus'),
  getLegalFiles: (): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('saves:getLegalFiles'),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('saves:openPath', path),

  scanLibrary: (): Promise<SavesScanEntry[]> => ipcRenderer.invoke('saves:scanLibrary'),
  getGameState: (gameId: number): Promise<SavesGameState | null> =>
    ipcRenderer.invoke('saves:getGameState', gameId),

  // ludusaviName solo lo manda la pantalla de resultados del escaneo, que es
  // la única que ya sabe con qué juego de ludusavi casó cada fila.
  setEnabled: (gameId: number, enabled: boolean, ludusaviName?: string): Promise<boolean> =>
    ipcRenderer.invoke('saves:setEnabled', gameId, enabled, ludusaviName),
  detect: (gameId: number): Promise<string | null> => ipcRenderer.invoke('saves:detect', gameId),
  addFolder: (gameId: number, folder: string): Promise<string | null> =>
    ipcRenderer.invoke('saves:addFolder', gameId, folder),
  removeFolder: (gameId: number, folder: string): Promise<boolean> =>
    ipcRenderer.invoke('saves:removeFolder', gameId, folder),

  backupNow: (gameId: number): Promise<SavesBackupResult | null> =>
    ipcRenderer.invoke('saves:backupNow', gameId),
  restore: (request: RestoreRequestInput): Promise<RestoreResult> =>
    ipcRenderer.invoke('saves:restore', request),
  setRestoreTarget: (gameId: number, target: string | null): Promise<void> =>
    ipcRenderer.invoke('saves:setRestoreTarget', gameId, target),
  deleteBackup: (backupId: number, gameId: number): Promise<boolean> =>
    ipcRenderer.invoke('saves:deleteBackup', backupId, gameId),

  // Copias automáticas en marcha (al cerrar una sesión). Devuelve la función
  // de limpieza que quita el listener, para encajar con el cleanup de
  // useEffect — mismo contrato que watcher.onGamesChanged.
  onActivity: (callback: (event: SavesActivityEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: SavesActivityEvent): void => callback(payload);
    ipcRenderer.on('saves:activity', listener);
    return () => ipcRenderer.removeListener('saves:activity', listener);
  },
};
