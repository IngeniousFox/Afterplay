import { eq } from 'drizzle-orm';
import { handleDb } from './dbHandle';
import { getDb } from '../db';
import { gamesTable } from '../db/schema';
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
import { queueAchievementsRefreshForGame } from '../steam/backfill';

// ¿Se juega con emulador? Lo pregunta el Play antes de armar el overlay —
// ver el porqué en su handler. Corre dentro del withDbAccess de handleDb,
// como todo lo demás de este fichero.
const isEmulatedGame = async (gameId: number): Promise<boolean> => {
  const [game] = await getDb()
    .select({ isEmulated: gamesTable.isEmulated })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);
  return game?.isEmulated === true;
};

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
    //
    // Y NUNCA para un juego emulado. El armado del Play viene con una gracia
    // de 90s durante la que los ceros del watcher no lo apagan (ver
    // notifyOverlaySessionStarted) — pensada para lanzadores lentos, cuyo
    // .exe el watcher acaba viendo. A un juego emulado no lo confirma nunca:
    // lo que corre es el EMULADOR (clave 'emu:'), y el conteo que arma el
    // overlay solo mira claves 'game:' (getActiveGameIds). Resultado real de
    // no filtrar: 90 segundos de ventana alwaysOnTop invisible sobre el
    // emulador — que roba el foco, y muchos emuladores se pausan al
    // perderlo. Antes de la gracia el primer cero la desmontaba en <=5s; con
    // ella, no. El juego emulado tampoco pierde nada a cambio: el HUD aún no
    // sabe pintar sesiones de emulador (pendiente conocido de OVERLAY.md).
    if (session && !(await isEmulatedGame(gameId))) notifyOverlaySessionStarted();
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
    // si la sesión ya terminó: si sigue en vivo, los dos disparadores de
    // abajo los lanzará el watcher al cerrarla (ya con el juego a bordo).
    if (session && session.endedAt !== null) {
      // scheduleSaveBackup solo arma un timer, así que no anida withDbAccess
      // dentro de este handler.
      scheduleSaveBackup(gameId);

      // Y los LOGROS, que se quedaban por el camino igual que el backup
      // (RETROACHIEVEMENTS.md §4.1: "un logro de RA con fecha del servidor
      // casa contra esas ventanas igual que uno de Steam"). Mientras jugabas,
      // el sondeo en vivo de RA guardó los desbloqueos SIN sesión: una sesión
      // de emulador nace con iterationId null y getSessionWindows la deja
      // fuera de su join con iterations, así que no había ninguna ventana
      // donde colgarlos. Y el cierre tampoco los recogió, porque el watcher
      // solo avisa del cierre si la sesión tenía iterationId. Sin esto, esa
      // fila se quedaba PARA SIEMPRE con cero trofeos aunque los logros
      // salieran desbloqueados en la lista del juego, y solo se arreglaba si
      // al usuario se le ocurría pulsar el refresco de la ficha.
      //
      // Se refresca en vez de recolocar con replaceUnlockPlacements (que es
      // local y sería más barato): el refresco vuelve a pasar por
      // storeUnlocks, y storeUnlocks es quien respeta la regla de NO colgar
      // de una sesión un desbloqueo con fecha no fiable — recolocar a secas
      // los cuelga todos, y los 25 de un rescate de Goldberg con el mismo
      // segundo acabarían inventándose que salieron en este rato concreto.
      //
      // Fire-and-forget (void): su trabajo de red no se queda dentro del
      // candado de la DB de este handler. Y notify:false porque esto no es
      // "acabas de sacarlo": son logros de hace rato, y el aviso flotante
      // solo cuenta lo que pasa ahora.
      void queueAchievementsRefreshForGame(gameId, { notify: false });
    }
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
