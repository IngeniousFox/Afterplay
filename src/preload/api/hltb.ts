import { invoke } from '../ipc';
import type { HltbTimes } from '../../shared/types';
import type { GameId } from '../../shared/entityIds';

export const hltbApi = {
  getTimes: (title: string, releaseYear: number | null): Promise<HltbTimes | null> =>
    invoke('hltb:getTimes', title, releaseYear),
  // Vuelve a preguntar por un juego YA dado de alta y guarda los tiempos
  // nuevos. null = HLTB no lo reconoció esta vez; lo que había se conserva.
  refreshGame: (gameId: GameId): Promise<HltbTimes | null> => invoke('hltb:refreshGame', gameId),
};
