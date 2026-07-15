import { ipcRenderer } from 'electron';
import type { AddStateEventInput, StateEvent, StateEventSummary } from '../../shared/types';

export const stateEventsApi = {
  add: (input: AddStateEventInput): Promise<StateEvent> =>
    ipcRenderer.invoke('stateEvents:add', input),
  getAll: (): Promise<StateEventSummary[]> => ipcRenderer.invoke('stateEvents:getAll'),
  getByIteration: (iterationId: number): Promise<StateEvent[]> =>
    ipcRenderer.invoke('stateEvents:getByIteration', iterationId),
  update: (id: number, note: string | null): Promise<StateEvent | null> =>
    ipcRenderer.invoke('stateEvents:update', id, note),
};
