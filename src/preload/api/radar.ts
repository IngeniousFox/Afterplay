import { ipcRenderer } from 'electron';
import type { RadarActivityEvent, RadarGame } from '../../shared/types';

// El radar de secuelas (PLAN-TO-PLAY.md §4): entregas anunciadas de tus sagas
// que todavia no tienes. La pasada corre sola una vez por semana en el main —
// aqui solo se leen sus descubrimientos y se descartan los que no interesan.
export const radarApi = {
  list: (): Promise<RadarGame[]> => ipcRenderer.invoke('radar:list'),
  dismiss: (igdbId: number): Promise<boolean> => ipcRenderer.invoke('radar:dismiss', igdbId),
  // Mismo contrato que el resto de onActivity: devuelve la limpieza.
  onActivity: (callback: (event: RadarActivityEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: RadarActivityEvent): void => callback(payload);
    ipcRenderer.on('radar:activity', listener);
    return () => ipcRenderer.removeListener('radar:activity', listener);
  },
};
