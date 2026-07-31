import { ipcRenderer } from 'electron';
import type {
  GeneratedMemorySummary,
  MemoriesStatus,
  MemoryActivityEvent,
} from '../../shared/types';

export const memoriesApi = {
  getAll: (): Promise<GeneratedMemorySummary[]> => ipcRenderer.invoke('memories:getAll'),
  getStatus: (): Promise<MemoriesStatus> => ipcRenderer.invoke('memories:getStatus'),
  // Arrancan la pasada y devuelven ya — el progreso llega por onActivity.
  runBackfill: (): Promise<void> => ipcRenderer.invoke('memories:runBackfill'),
  regenerateStale: (): Promise<void> => ipcRenderer.invoke('memories:regenerateStale'),
  stop: (): Promise<void> => ipcRenderer.invoke('memories:stop'),
  // Mismo contrato que curiosities.onActivity: devuelve la función de
  // limpieza, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: MemoryActivityEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: MemoryActivityEvent): void => callback(payload);
    ipcRenderer.on('memories:activity', listener);
    return () => ipcRenderer.removeListener('memories:activity', listener);
  },
};
