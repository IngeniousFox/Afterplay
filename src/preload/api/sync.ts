import { ipcRenderer } from 'electron';
import type { PairRequest, SyncStatus } from '../../shared/sync/status';

// Resultado de emparejar: ok con el estado nuevo, o la frase para mostrar.
export type PairResponse = { ok: true; status: SyncStatus } | { ok: false; message: string };

export const syncApi = {
  getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:getStatus'),
  pair: (request: PairRequest): Promise<PairResponse> => ipcRenderer.invoke('sync:pair', request),
  unpair: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:unpair'),
  syncNow: (): Promise<void> => ipcRenderer.invoke('sync:syncNow'),
  // Una descarga cambió filas de estas tablas (§15.4): el renderer refresca
  // las consultas que dependen de ellas. Devuelve la función de limpieza.
  onChanged: (callback: (tables: string[]) => void): (() => void) => {
    const listener = (_event: unknown, payload: { tables: string[] }): void =>
      callback(payload.tables);
    ipcRenderer.on('sync:changed', listener);
    return () => ipcRenderer.removeListener('sync:changed', listener);
  },
  // El estado del sync cambió (ciclo terminado, emparejado…).
  onStatus: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('sync:status', listener);
    return () => ipcRenderer.removeListener('sync:status', listener);
  },
};
