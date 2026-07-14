import { ipcRenderer } from 'electron';
import type { AddSpendEventInput, SpendEvent } from '../../shared/types';

export const spendApi = {
  add: (input: AddSpendEventInput): Promise<SpendEvent> => ipcRenderer.invoke('spend:add', input),
  getByGame: (gameId: number): Promise<SpendEvent[]> =>
    ipcRenderer.invoke('spend:getByGame', gameId),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('spend:delete', id),
  update: (id: number, note: string | null): Promise<SpendEvent | null> =>
    ipcRenderer.invoke('spend:update', id, note),
};
