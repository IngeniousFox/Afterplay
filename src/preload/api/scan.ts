import { ipcRenderer } from 'electron';
import type { ScanCandidate } from '../../main/scan/contracts';

export const scanApi = {
  // Las carpetas elegidas se recuerdan entre escaneos (config de la máquina,
  // no de la BD sincronizada).
  getFolders: (): Promise<string[]> => ipcRenderer.invoke('scan:getFolders'),
  setFolders: (folders: string[]): Promise<string[]> =>
    ipcRenderer.invoke('scan:setFolders', folders),
  run: (folders: string[]): Promise<ScanCandidate[]> => ipcRenderer.invoke('scan:run', folders),
};
