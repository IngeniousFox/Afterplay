import { ipcRenderer } from 'electron';
import type {
  ExternalDataStatus,
  ExternalRefreshEvent,
  GameFullRefreshResult,
  RatingsRefreshResult,
} from '../../shared/types';

// Datos externos de la biblioteca (PLAN-TO-PLAY.md §5): notas y sinopsis de
// IGDB, fecha de salida con su precisión, sagas, y etiquetas + reseñas de
// Steam. Un solo mecanismo con dos puertas — la cabecera del Plan (solo
// planeados, el día a día) y Ajustes (biblioteca entera, mantenimiento).
export const externalApi = {
  status: (): Promise<ExternalDataStatus> => ipcRenderer.invoke('external:status'),
  // Arrancan la pasada y devuelven ya, con cuantos juegos entran en ella — el
  // progreso llega por onActivity. La pasada dura minutos y no
  // puede colgar un invoke (ni morirse porque cierres Ajustes).
  refreshAll: (): Promise<number> => ipcRenderer.invoke('external:refreshAll'),
  refreshPlan: (): Promise<number> => ipcRenderer.invoke('external:refreshPlan'),
  // La de UN juego, desde su ficha: aquí SÍ se espera al resultado (son
  // segundos, no minutos) y vuelve el parte de qué pudo con qué. null = ese
  // juego ya no existe.
  refreshGame: (gameId: number): Promise<GameFullRefreshResult | null> =>
    ipcRenderer.invoke('external:refreshGame', gameId),
  // Y la del ⟳ de la card Ratings: solo las tres notas que esa card enseña
  // (las dos de IGDB y el % de Steam). Guarda de paso la sinopsis, las sagas
  // y la fecha completa, que vienen en la misma respuesta de IGDB.
  refreshRatings: (gameId: number): Promise<RatingsRefreshResult | null> =>
    ipcRenderer.invoke('external:refreshRatings', gameId),
  // Mismo contrato que curiosities.onActivity: devuelve la funcion de limpieza
  // que quita el listener, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: ExternalRefreshEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: ExternalRefreshEvent): void => callback(payload);
    ipcRenderer.on('external:activity', listener);
    return () => ipcRenderer.removeListener('external:activity', listener);
  },
};
