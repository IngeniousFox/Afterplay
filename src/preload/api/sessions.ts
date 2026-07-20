import { ipcRenderer } from 'electron';
import type { PendingSession, Session, SessionWithGame } from '../../shared/types';

export const sessionsApi = {
  getAll: (): Promise<SessionWithGame[]> => ipcRenderer.invoke('sessions:getAll'),
  close: (id: number, endedAt: Date): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:close', id, endedAt),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('sessions:delete', id),
  startForGame: (gameId: number): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:startForGame', gameId),
  getPending: (): Promise<PendingSession[]> => ipcRenderer.invoke('sessions:getPending'),
  assign: (sessionId: number, gameId: number): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:assign', sessionId, gameId),
  deletePending: (sessionId: number): Promise<boolean> =>
    ipcRenderer.invoke('sessions:deletePending', sessionId),
};
