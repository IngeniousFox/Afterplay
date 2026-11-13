import { ipcRenderer } from 'electron';
import type {
  AddStateEventInput,
  StateEvent,
  StateEventSummary,
  UpdateStateEventPatch,
} from '../../shared/types';
import type { StateEventId } from '../../shared/entityIds';

export const stateEventsApi = {
  add: (input: AddStateEventInput): Promise<StateEvent> =>
    ipcRenderer.invoke('stateEvents:add', input),
  getAll: (): Promise<StateEventSummary[]> => ipcRenderer.invoke('stateEvents:getAll'),
  update: (id: StateEventId, patch: UpdateStateEventPatch): Promise<StateEvent | null> =>
    ipcRenderer.invoke('stateEvents:update', id, patch),
  delete: (id: StateEventId): Promise<boolean> => ipcRenderer.invoke('stateEvents:delete', id),
};
