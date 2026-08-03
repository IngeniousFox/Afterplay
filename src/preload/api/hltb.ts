import { ipcRenderer } from 'electron';
import type { HltbTimes } from '../../shared/types';

export const hltbApi = {
  getTimes: (title: string, releaseYear: number | null): Promise<HltbTimes | null> =>
    ipcRenderer.invoke('hltb:getTimes', title, releaseYear),
  // Vuelve a preguntar por un juego YA dado de alta y guarda los tiempos
  // nuevos. null = HLTB no lo reconoció esta vez; lo que había se conserva.
  refreshGame: (gameId: number): Promise<HltbTimes | null> =>
    ipcRenderer.invoke('hltb:refreshGame', gameId),
};
