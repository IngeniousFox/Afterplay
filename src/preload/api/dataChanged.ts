import { subscribe } from '../ipc';
import type { DataChanged } from '../../shared/ipc/dataChanged';

export const dataChangedApi = {
  // El único aviso de cambio de datos del main (§15.4): tras cada transacción
  // confirmada (mutaciones y watcher) y tras cada página de bajada del sync
  // que aplicó algo. Devuelve la función de limpieza que quita el listener.
  onChanged: (callback: (change: DataChanged) => void): (() => void) =>
    subscribe('data:changed', callback),
};
