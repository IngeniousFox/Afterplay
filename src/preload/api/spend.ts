import { ipcRenderer } from 'electron';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../shared/types';

export const spendApi = {
  add: (input: AddSpendEventInput): Promise<SpendEvent> => ipcRenderer.invoke('spend:add', input),
  getAll: (): Promise<SpendEventSummary[]> => ipcRenderer.invoke('spend:getAll'),
  getByGame: (gameId: number): Promise<SpendEvent[]> =>
    ipcRenderer.invoke('spend:getByGame', gameId),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('spend:delete', id),
  update: (id: number, patch: UpdateSpendEventPatch): Promise<SpendEvent | null> =>
    ipcRenderer.invoke('spend:update', id, patch),
};
