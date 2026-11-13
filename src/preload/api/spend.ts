import { ipcRenderer } from 'electron';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../shared/types';
import type { SpendEventId } from '../../shared/entityIds';

export const spendApi = {
  add: (input: AddSpendEventInput): Promise<SpendEvent> => ipcRenderer.invoke('spend:add', input),
  getAll: (): Promise<SpendEventSummary[]> => ipcRenderer.invoke('spend:getAll'),
  delete: (id: SpendEventId): Promise<boolean> => ipcRenderer.invoke('spend:delete', id),
  update: (id: SpendEventId, patch: UpdateSpendEventPatch): Promise<SpendEvent | null> =>
    ipcRenderer.invoke('spend:update', id, patch),
};
