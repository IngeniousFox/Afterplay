import { invoke, subscribe } from '../ipc';
import type { PairRequest, SyncStatus } from '../../shared/sync/status';

// Resultado de emparejar: ok con el estado nuevo, o la frase para mostrar.
export type PairResponse = { ok: true; status: SyncStatus } | { ok: false; message: string };

export const syncApi = {
  getStatus: (): Promise<SyncStatus> => invoke('sync:getStatus'),
  pair: (request: PairRequest): Promise<PairResponse> => invoke('sync:pair', request),
  unpair: (): Promise<SyncStatus> => invoke('sync:unpair'),
  syncNow: (): Promise<void> => invoke('sync:syncNow'),
  // El estado del sync cambió (ciclo terminado, emparejado…).
  onStatus: (callback: () => void): (() => void) => subscribe('sync:status', callback),
};
