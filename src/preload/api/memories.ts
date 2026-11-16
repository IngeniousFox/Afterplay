import { invoke, subscribe } from '../ipc';
import type {
  GeneratedMemorySummary,
  MemoriesStatus,
  MemoryActivityEvent,
} from '../../shared/types';

export const memoriesApi = {
  getAll: (): Promise<GeneratedMemorySummary[]> => invoke('memories:getAll'),
  getStatus: (): Promise<MemoriesStatus> => invoke('memories:getStatus'),
  // Arrancan la pasada y devuelven ya — el progreso llega por onActivity.
  runBackfill: (): Promise<void> => invoke('memories:runBackfill'),
  regenerateStale: (): Promise<void> => invoke('memories:regenerateStale'),
  stop: (): Promise<void> => invoke('memories:stop'),
  // Mismo contrato que curiosities.onActivity: devuelve la función de
  // limpieza, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: MemoryActivityEvent) => void): (() => void) =>
    subscribe('memories:activity', callback),
};
