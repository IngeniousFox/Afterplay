import { invoke, subscribe } from '../ipc';
import type { RadarActivityEvent, RadarGame } from '../../shared/types';

// El radar de secuelas (PLAN-TO-PLAY.md §4): entregas anunciadas de tus sagas
// que todavia no tienes. La pasada corre sola una vez por semana en el main —
// aqui solo se leen sus descubrimientos y se descartan los que no interesan.
export const radarApi = {
  list: (): Promise<RadarGame[]> => invoke('radar:list'),
  dismiss: (igdbId: number): Promise<boolean> => invoke('radar:dismiss', igdbId),
  // Mismo contrato que el resto de onActivity: devuelve la limpieza.
  onActivity: (callback: (event: RadarActivityEvent) => void): (() => void) =>
    subscribe('radar:activity', callback),
};
