import { ipcRenderer } from 'electron';
import type {
  PendingSession,
  Session,
  SessionClosedEvent,
  SessionWithGame,
} from '../../shared/types';

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
  setNote: (id: number, note: string): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:setNote', id, note),

  // Un juego acaba de cerrarse (lo detecta el watcher, no el renderer): es lo
  // que dispara el aviso con la duración y el atajo para escribir la nota.
  // Mismo contrato que saves.onActivity — devuelve su propia limpieza.
  onSessionClosed: (callback: (event: SessionClosedEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: SessionClosedEvent): void => callback(payload);
    ipcRenderer.on('sessions:closed', listener);
    return () => ipcRenderer.removeListener('sessions:closed', listener);
  },
};
