import { handleDb } from './dbHandle';
import { closeSession } from '../db/queries/sessions/closeSession';
import { deleteSession } from '../db/queries/sessions/deleteSession';
import { getAllSessions } from '../db/queries/sessions/getAllSessions';
import { assignSession } from '../db/queries/sessions/assignSession';
import { deletePendingSession } from '../db/queries/sessions/deletePendingSession';
import { getPendingSessions } from '../db/queries/sessions/getPendingSessions';
import { startGameSession } from '../db/queries/sessions/startGameSession';
import { updateSessionNote } from '../db/queries/sessions/updateSessionNote';
import { notifyOverlaySessionStarted } from '../overlay';
import { scheduleSaveBackup } from '../saves/sessionHook';

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
    const session = await startGameSession(gameId);
    // El overlay in-game se arma AQUÍ y no esperando al watcher (que sondea
    // cada 5s): pulsar Play y que su atajo no respondiera durante esos
    // segundos era justo lo que se sentía roto. Solo si la sesión abrió de
    // verdad — un null significa que ya había una viva, y entonces el
    // overlay ya estaba armado.
    if (session) notifyOverlaySessionStarted();
    return session;
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
    const session = await assignSession(sessionId, gameId);
    // La asignación es EL momento en que por fin se sabe de qué juego son
    // esas partidas — el equivalente al cierre de sesión de un juego normal
    // (§10.2), que aquí pasó de largo porque la sesión era de emulador. Solo
    // si la sesión ya terminó: si sigue en vivo, el backup lo disparará el
    // watcher al cerrarla (ya con el juego a bordo). scheduleSaveBackup solo
    // arma un timer, así que no anida withDbAccess dentro de este handler.
    if (session && session.endedAt !== null) scheduleSaveBackup(gameId);
    return session;
  });

  handleDb('sessions:deletePending', async (_event, sessionId: number) => {
    return deletePendingSession(sessionId);
  });

  // Diario de sesión — desde el aviso de cierre o desde la fila de la sesión.
  handleDb('sessions:setNote', async (_event, id: number, note: string) => {
    return updateSessionNote(id, note);
  });
};
