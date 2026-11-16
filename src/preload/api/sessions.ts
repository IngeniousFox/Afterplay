import { invoke, subscribe } from '../ipc';
import type {
  PendingSession,
  Session,
  SessionClosedEvent,
  SessionWithGame,
  SessionsPage,
  SessionsPageRequest,
  SessionsRangeRequest,
} from '../../shared/types';
import type { GameId, SessionId } from '../../shared/entityIds';

export const sessionsApi = {
  // Lecturas acotadas (F-41): no hay un `getAll`; cada pantalla pide lo que pinta.
  getOpen: (): Promise<SessionWithGame[]> => invoke('sessions:getOpen'),
  getForGame: (gameId: GameId): Promise<SessionWithGame[]> => invoke('sessions:getForGame', gameId),
  getRange: (range: SessionsRangeRequest): Promise<SessionWithGame[]> =>
    invoke('sessions:getRange', range),
  getPage: (request: SessionsPageRequest): Promise<SessionsPage> =>
    invoke('sessions:getPage', request),
  close: (id: SessionId, endedAt: Date): Promise<Session | null> =>
    invoke('sessions:close', id, endedAt),
  delete: (id: SessionId): Promise<boolean> => invoke('sessions:delete', id),
  startForGame: (gameId: GameId): Promise<Session | null> =>
    invoke('sessions:startForGame', gameId),
  getPending: (): Promise<PendingSession[]> => invoke('sessions:getPending'),
  assign: (sessionId: SessionId, gameId: GameId): Promise<Session | null> =>
    invoke('sessions:assign', sessionId, gameId),
  deletePending: (sessionId: SessionId): Promise<boolean> =>
    invoke('sessions:deletePending', sessionId),
  setNote: (id: SessionId, note: string): Promise<Session | null> =>
    invoke('sessions:setNote', id, note),

  // Un juego acaba de cerrarse (lo detecta el watcher, no el renderer): es lo
  // que dispara el aviso con la duración y el atajo para escribir la nota.
  // Mismo contrato que saves.onActivity — devuelve su propia limpieza.
  onSessionClosed: (callback: (event: SessionClosedEvent) => void): (() => void) =>
    subscribe('sessions:closed', callback),
};
