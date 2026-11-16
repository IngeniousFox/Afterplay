import { invoke, subscribe } from '../ipc';
import type {
  AchievementActivityEvent,
  AchievementsOverview,
  AchievementsStatus,
  GameAchievements,
  SessionUnlock,
} from '../../shared/types';
import type { GameId } from '../../shared/entityIds';

export const achievementsApi = {
  getForGame: (gameId: GameId): Promise<GameAchievements> =>
    invoke('achievements:getForGame', gameId),
  getStatus: (): Promise<AchievementsStatus> => invoke('achievements:getStatus'),
  // La vista global (salón de la fama, años, muro de 100%, almost there)
  // para el bloque de trofeos de Stats. year=null → All Time.
  getOverview: (year: number | null): Promise<AchievementsOverview> =>
    invoke('achievements:getOverview', year),
  // Los desbloqueos colgados de sesiones (filas de la pantalla de Sesiones).
  getSessionUnlocks: (): Promise<SessionUnlock[]> => invoke('achievements:getSessionUnlocks'),
  // Arranca la pasada y devuelve cuántos juegos entraron en la cola — el
  // progreso llega por onActivity. full=true resincroniza TODOS los juegos de
  // Steam (el botón de Ajustes); false solo los que no tienen catálogo.
  sync: (full: boolean): Promise<number> => invoke('achievements:sync', full),
  stop: (): Promise<void> => invoke('achievements:stop'),
  // Reintenta solo los juegos que fallaron; devuelve cuántos se encolaron.
  retryFailed: (): Promise<number> => invoke('achievements:retryFailed'),
  // Vuelve a traer catálogo y desbloqueos de UN juego. Devuelve si entró en
  // la cola (false = sin clave de Steam, o el juego no está en Steam); el
  // resultado llega por onActivity con kind:'synced' y ese gameId.
  refreshGame: (gameId: GameId): Promise<boolean> => invoke('achievements:refreshGame', gameId),
  replacePlacements: (gameId: GameId): Promise<number> =>
    invoke('achievements:replacePlacements', gameId),
  // Mismo contrato que curiosities.onActivity: devuelve la función de
  // limpieza, para encajar con el cleanup de useEffect.
  onActivity: (callback: (event: AchievementActivityEvent) => void): (() => void) =>
    subscribe('achievements:activity', callback),
};
