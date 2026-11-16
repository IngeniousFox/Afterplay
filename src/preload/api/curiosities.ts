import { invoke, subscribe } from '../ipc';
import type {
  CuriositiesStatus,
  CuriosityActivityEvent,
  CuriositySummary,
} from '../../shared/types';

export const curiositiesApi = {
  getAll: (): Promise<CuriositySummary[]> => invoke('curiosities:getAll'),
  getStatus: (): Promise<CuriositiesStatus> => invoke('curiosities:getStatus'),
  // Arranca la pasada y devuelve ya — el progreso llega por onActivity.
  runBackfill: (): Promise<void> => invoke('curiosities:runBackfill'),
  // Mismo contrato que saves.onActivity: devuelve la función de limpieza que
  // quita el listener, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: CuriosityActivityEvent) => void): (() => void) =>
    subscribe('curiosities:activity', callback),
};
