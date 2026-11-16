import { invoke, subscribe } from '../ipc';
import type { PairRequest, SyncStatus } from '../../shared/sync/status';

// Resultado de emparejar: ok con el estado nuevo, o la frase para mostrar.
export type PairResponse = { ok: true; status: SyncStatus } | { ok: false; message: string };

export const syncApi = {
  getStatus: (): Promise<SyncStatus> => invoke('sync:getStatus'),
  pair: (request: PairRequest): Promise<PairResponse> => invoke('sync:pair', request),
  unpair: (): Promise<SyncStatus> => invoke('sync:unpair'),
  syncNow: (): Promise<void> => invoke('sync:syncNow'),
  // Una descarga cambió filas de estas tablas (§15.4): el renderer refresca
  // las consultas que dependen de ellas. Devuelve la función de limpieza.
  onChanged: (callback: (tables: string[]) => void): (() => void) =>
    subscribe('sync:changed', (payload) => callback(payload.tables)),
  // El estado del sync cambió (ciclo terminado, emparejado…).
  onStatus: (callback: () => void): (() => void) => subscribe('sync:status', callback),
};
