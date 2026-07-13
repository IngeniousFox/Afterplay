import { ipcRenderer } from 'electron';
import type { AddStateEventInput, StateEvent } from '../../shared/types';

export const stateEventsApi = {
  add: (input: AddStateEventInput): Promise<StateEvent> =>
    ipcRenderer.invoke('stateEvents:add', input),
  getByIteration: (iterationId: number): Promise<StateEvent[]> =>
    ipcRenderer.invoke('stateEvents:getByIteration', iterationId),
};
