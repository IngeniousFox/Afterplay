import { ipcRenderer } from 'electron';
import type { HltbTimes } from '../../shared/types';

export const hltbApi = {
  getTimes: (title: string, releaseYear: number | null): Promise<HltbTimes | null> =>
    ipcRenderer.invoke('hltb:getTimes', title, releaseYear),
};
