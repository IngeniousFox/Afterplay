import { handleDb } from './dbHandle';
import type { AddManualSessionInput } from '../../shared/types';
import { addManualSession } from '../db/queries/sessions/addManualSession';
import { closeSession } from '../db/queries/sessions/closeSession';
import { getAllSessions } from '../db/queries/sessions/getAllSessions';
import { getSessionsByIteration } from '../db/queries/sessions/getSessionsByIteration';
import { startGameSession } from '../db/queries/sessions/startGameSession';

export const registerSessionsHandlers = (): void => {
  handleDb('sessions:add', async (_event, input: AddManualSessionInput) => {
    return addManualSession(input);
  });

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

  handleDb('sessions:getByIteration', async (_event, iterationId: number) => {
    return getSessionsByIteration(iterationId);
  });

  handleDb('sessions:close', async (_event, id: number, endedAt: Date) => {
    return closeSession(id, endedAt);
  });
};
