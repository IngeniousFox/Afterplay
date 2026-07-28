import { ipcRenderer } from 'electron';
import type {
  AddStateEventInput,
  StateEvent,
  StateEventSummary,
  UpdateStateEventPatch,
} from '../../shared/types';

export const stateEventsApi = {
  add: (input: AddStateEventInput): Promise<StateEvent> =>
    ipcRenderer.invoke('stateEvents:add', input),
  getAll: (): Promise<StateEventSummary[]> => ipcRenderer.invoke('stateEvents:getAll'),
  update: (id: number, patch: UpdateStateEventPatch): Promise<StateEvent | null> =>
    ipcRenderer.invoke('stateEvents:update', id, patch),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('stateEvents:delete', id),
};
