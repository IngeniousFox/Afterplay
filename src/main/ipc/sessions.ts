import { handleDb } from './dbHandle';
import type { AddManualSessionInput } from '../../shared/types';
import { addManualSession } from '../db/queries/sessions/addManualSession';
import { closeSession } from '../db/queries/sessions/closeSession';
import { getSessionsByIteration } from '../db/queries/sessions/getSessionsByIteration';

export const registerSessionsHandlers = (): void => {
  handleDb('sessions:add', async (_event, input: AddManualSessionInput) => {
    return addManualSession(input);
  });

  handleDb('sessions:getByIteration', async (_event, iterationId: number) => {
    return getSessionsByIteration(iterationId);
  });

  handleDb('sessions:close', async (_event, id: number, endedAt: Date) => {
    return closeSession(id, endedAt);
  });
};
