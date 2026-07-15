import { ipcRenderer } from 'electron';
import type { AddManualSessionInput, Session, SessionWithGame } from '../../shared/types';

export const sessionsApi = {
  add: (input: AddManualSessionInput): Promise<Session> =>
    ipcRenderer.invoke('sessions:add', input),
  getAll: (): Promise<SessionWithGame[]> => ipcRenderer.invoke('sessions:getAll'),
  getByIteration: (iterationId: number): Promise<Session[]> =>
    ipcRenderer.invoke('sessions:getByIteration', iterationId),
  close: (id: number, endedAt: Date): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:close', id, endedAt),
};
