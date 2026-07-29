import { ipcRenderer } from 'electron';
import type {
  CuriositiesStatus,
  CuriosityActivityEvent,
  CuriositySummary,
} from '../../shared/types';

export const curiositiesApi = {
  getAll: (): Promise<CuriositySummary[]> => ipcRenderer.invoke('curiosities:getAll'),
  getStatus: (): Promise<CuriositiesStatus> => ipcRenderer.invoke('curiosities:getStatus'),
  // Arranca la pasada y devuelve ya — el progreso llega por onActivity.
  runBackfill: (): Promise<void> => ipcRenderer.invoke('curiosities:runBackfill'),
  // Mismo contrato que saves.onActivity: devuelve la función de limpieza que
  // quita el listener, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: CuriosityActivityEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: CuriosityActivityEvent): void => callback(payload);
    ipcRenderer.on('curiosities:activity', listener);
    return () => ipcRenderer.removeListener('curiosities:activity', listener);
  },
};
