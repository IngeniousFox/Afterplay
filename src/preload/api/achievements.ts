import { ipcRenderer } from 'electron';
import type {
  AchievementActivityEvent,
  AchievementsStatus,
  GameAchievements,
} from '../../shared/types';

export const achievementsApi = {
  getForGame: (gameId: number): Promise<GameAchievements> =>
    ipcRenderer.invoke('achievements:getForGame', gameId),
  getStatus: (): Promise<AchievementsStatus> => ipcRenderer.invoke('achievements:getStatus'),
  // Arranca la pasada y devuelve cuántos juegos entraron en la cola — el
  // progreso llega por onActivity. full=true resincroniza TODOS los juegos de
  // Steam (el botón de Ajustes); false solo los que no tienen catálogo.
  sync: (full: boolean): Promise<number> => ipcRenderer.invoke('achievements:sync', full),
  stop: (): Promise<void> => ipcRenderer.invoke('achievements:stop'),
  // Reintenta solo los juegos que fallaron; devuelve cuántos se encolaron.
  retryFailed: (): Promise<number> => ipcRenderer.invoke('achievements:retryFailed'),
  // ⚠️ TEMPORAL — enciende/apaga el modo de prueba del aviso flotante y
  // devuelve si quedó encendido. Quitar con su botón cuando el diseño esté
  // cerrado (ver main/steam/notifications/overlay.ts).
  toggleDemo: (): Promise<boolean> => ipcRenderer.invoke('achievements:toggleDemo'),
  replacePlacements: (gameId: number): Promise<number> =>
    ipcRenderer.invoke('achievements:replacePlacements', gameId),
  // Mismo contrato que curiosities.onActivity: devuelve la función de
  // limpieza, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: AchievementActivityEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: AchievementActivityEvent): void =>
      callback(payload);
    ipcRenderer.on('achievements:activity', listener);
    return () => ipcRenderer.removeListener('achievements:activity', listener);
  },
};
