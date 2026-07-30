import type { ResolveSessionEpilogueInput } from '../../shared/types';
import {
  getPendingSessionEpilogues,
  getSessionEpilogueById,
} from '../db/queries/sessionEpilogues/getSessionEpilogues';
import { resolveSessionEpilogue } from '../db/queries/sessionEpilogues/resolveSessionEpilogue';
import { handleDb } from './dbHandle';

export const registerSessionEpiloguesHandlers = (): void => {
  handleDb('sessionEpilogues:getPending', async () => getPendingSessionEpilogues());
  handleDb('sessionEpilogues:getById', async (_event, id: number) => getSessionEpilogueById(id));
  handleDb('sessionEpilogues:resolve', async (_event, input: ResolveSessionEpilogueInput) =>
    resolveSessionEpilogue(input),
  );
};
