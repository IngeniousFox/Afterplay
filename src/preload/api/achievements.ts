import { ipcRenderer } from 'electron';
import type {
  AchievementActivityEvent,
  AchievementsOverview,
  AchievementsStatus,
  GameAchievements,
  SessionUnlock,
} from '../../shared/types';

export const achievementsApi = {
  getForGame: (gameId: number): Promise<GameAchievements> =>
    ipcRenderer.invoke('achievements:getForGame', gameId),
  getStatus: (): Promise<AchievementsStatus> => ipcRenderer.invoke('achievements:getStatus'),
  // La vista global (salón de la fama, años, muro de 100%, almost there)
  // para el bloque de trofeos de Stats. year=null → All Time.
  getOverview: (year: number | null): Promise<AchievementsOverview> =>
    ipcRenderer.invoke('achievements:getOverview', year),
  // Los desbloqueos colgados de sesiones (filas de la pantalla de Sesiones).
  getSessionUnlocks: (): Promise<SessionUnlock[]> =>
    ipcRenderer.invoke('achievements:getSessionUnlocks'),
  // Arranca la pasada y devuelve cuántos juegos entraron en la cola — el
  // progreso llega por onActivity. full=true resincroniza TODOS los juegos de
  // Steam (el botón de Ajustes); false solo los que no tienen catálogo.
  sync: (full: boolean): Promise<number> => ipcRenderer.invoke('achievements:sync', full),
  stop: (): Promise<void> => ipcRenderer.invoke('achievements:stop'),
  // Reintenta solo los juegos que fallaron; devuelve cuántos se encolaron.
  retryFailed: (): Promise<number> => ipcRenderer.invoke('achievements:retryFailed'),
  // Vuelve a traer catálogo y desbloqueos de UN juego. Devuelve si entró en
  // la cola (false = sin clave de Steam, o el juego no está en Steam); el
  // resultado llega por onActivity con kind:'synced' y ese gameId.
  refreshGame: (gameId: number): Promise<boolean> =>
    ipcRenderer.invoke('achievements:refreshGame', gameId),
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
