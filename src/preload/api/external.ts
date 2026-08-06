import { ipcRenderer } from 'electron';
import type { ExternalDataStatus, ExternalRefreshEvent } from '../../shared/types';

// Datos externos de la biblioteca (PLAN-TO-PLAY.md §5): notas y sinopsis de
// IGDB, fecha de salida con su precisión, sagas, y etiquetas + reseñas de
// SteamSpy. Un solo mecanismo con dos puertas — la cabecera del Plan (solo
// planeados, el día a día) y Ajustes (biblioteca entera, mantenimiento).
export const externalApi = {
  status: (): Promise<ExternalDataStatus> => ipcRenderer.invoke('external:status'),
  // Arrancan la pasada y devuelven ya, con cuantos juegos entran en ella — el
  // progreso llega por onActivity. La pasada de SteamSpy dura minutos y no
  // puede colgar un invoke (ni morirse porque cierres Ajustes).
  refreshAll: (): Promise<number> => ipcRenderer.invoke('external:refreshAll'),
  refreshPlan: (): Promise<number> => ipcRenderer.invoke('external:refreshPlan'),
  // Mismo contrato que curiosities.onActivity: devuelve la funcion de limpieza
  // que quita el listener, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: ExternalRefreshEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: ExternalRefreshEvent): void => callback(payload);
    ipcRenderer.on('external:activity', listener);
    return () => ipcRenderer.removeListener('external:activity', listener);
  },
};
