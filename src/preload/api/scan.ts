import { ipcRenderer } from 'electron';
import type { ScanReport } from '../../main/scan/contracts';

export const scanApi = {
  // Las carpetas elegidas se recuerdan entre escaneos (config de la máquina,
  // no de la BD sincronizada).
  getFolders: (): Promise<string[]> => ipcRenderer.invoke('scan:getFolders'),
  setFolders: (folders: string[]): Promise<string[]> =>
    ipcRenderer.invoke('scan:setFolders', folders),
  // Lo que ya se sabe: sale de la caché en disco, es instantáneo.
  cached: (): Promise<ScanReport> => ipcRenderer.invoke('scan:cached'),
  // Forzar un escaneo completo, ignorando la caché.
  run: (): Promise<ScanReport> => ipcRenderer.invoke('scan:run'),

  // El vigilante del main avisa cuando ha encontrado (o perdido) carpetas
  // por su cuenta. Devuelve la baja para poder llamarla desde el cleanup de
  // un useEffect — mismo contrato que watcher.onGamesChanged.
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('scan:changed', listener);
    return () => ipcRenderer.removeListener('scan:changed', listener);
  },
};
