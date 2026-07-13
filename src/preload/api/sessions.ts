import { ipcRenderer } from 'electron';
import type { AddManualSessionInput, Session } from '../../shared/types';

export const sessionsApi = {
  add: (input: AddManualSessionInput): Promise<Session> =>
    ipcRenderer.invoke('sessions:add', input),
  getByIteration: (iterationId: number): Promise<Session[]> =>
    ipcRenderer.invoke('sessions:getByIteration', iterationId),
};
