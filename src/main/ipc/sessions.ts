import { handleDb } from './dbHandle';
import { closeSession } from '../db/queries/sessions/closeSession';
import { deleteSession } from '../db/queries/sessions/deleteSession';
import { getAllSessions } from '../db/queries/sessions/getAllSessions';
import { assignSession } from '../db/queries/sessions/assignSession';
import { deletePendingSession } from '../db/queries/sessions/deletePendingSession';
import { getPendingSessions } from '../db/queries/sessions/getPendingSessions';
import { startGameSession } from '../db/queries/sessions/startGameSession';

// Modelo v2: fuera sessions:add y sessions:updateMilestone*(...) — los
// marcadores de borde ya no existen; las fechas y desenlaces de un
// playthrough se corrigen editando sus stateEvents (stateEvents:update).
export const registerSessionsHandlers = (): void => {
  // Botón Play (ActionBar): misma función que usa el watcher al detectar un
  // arranque (startGameSession) — no una reimplementación aparte a mano en
  // el renderer, para que el resultado sea IDÉNTICO se dispare como se
  // dispare: isManual:false, misma lógica de qué playthrough usar/crear, y
  // todo en una sola transacción. Devuelve null si ya había una sesión
  // abierta (no debería pasar — el botón está deshabilitado mientras hay una
  // live — pero no es un error, el juego ya se está trackeando igual).
  handleDb('sessions:startForGame', async (_event, gameId: number) => {
    return startGameSession(gameId);
  });

  handleDb('sessions:getAll', async () => {
    return getAllSessions();
  });

  handleDb('sessions:close', async (_event, id: number, endedAt: Date) => {
    return closeSession(id, endedAt);
  });

  // Borrar una sesión cerrada (vista de Sesiones / Session History del
  // detalle) — rechaza abiertas (ver deleteSession.ts).
  handleDb('sessions:delete', async (_event, id: number) => {
    return deleteSession(id);
  });

  // EMULADORES.md — bandeja de sesiones de emulador sin asignar y su
  // asignación a un juego de la biblioteca.
  handleDb('sessions:getPending', async () => {
    return getPendingSessions();
  });

  handleDb('sessions:assign', async (_event, sessionId: number, gameId: number) => {
    return assignSession(sessionId, gameId);
  });

  handleDb('sessions:deletePending', async (_event, sessionId: number) => {
    return deletePendingSession(sessionId);
  });
};
