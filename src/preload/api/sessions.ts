import { ipcRenderer } from 'electron';
import type {
  AddManualSessionInput,
  PendingSession,
  Session,
  SessionWithGame,
} from '../../shared/types';

export const sessionsApi = {
  add: (input: AddManualSessionInput): Promise<Session> =>
    ipcRenderer.invoke('sessions:add', input),
  getAll: (): Promise<SessionWithGame[]> => ipcRenderer.invoke('sessions:getAll'),
  close: (id: number, endedAt: Date): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:close', id, endedAt),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('sessions:delete', id),
  startForGame: (gameId: number): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:startForGame', gameId),
  updateMilestone: (
    id: number,
    date: Date,
    precision: 'year' | 'month' | 'day',
  ): Promise<Session | null> => ipcRenderer.invoke('sessions:updateMilestone', id, date, precision),
  updateMilestoneOutcome: (
    id: number,
    milestone: 'completed' | 'dropped' | 'on_hold',
  ): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:updateMilestoneOutcome', id, milestone),
  getPending: (): Promise<PendingSession[]> => ipcRenderer.invoke('sessions:getPending'),
  assign: (sessionId: number, gameId: number): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:assign', sessionId, gameId),
  deletePending: (sessionId: number): Promise<boolean> =>
    ipcRenderer.invoke('sessions:deletePending', sessionId),
};
