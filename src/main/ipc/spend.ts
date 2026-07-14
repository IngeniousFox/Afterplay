import { handleDb } from './dbHandle';
import type { AddSpendEventInput } from '../../shared/types';
import { addSpendEvent } from '../db/queries/spend/addSpendEvent';
import { deleteSpendEvent } from '../db/queries/spend/deleteSpendEvent';
import { getSpendByGame } from '../db/queries/spend/getSpendByGame';
import { updateSpendEvent } from '../db/queries/spend/updateSpendEvent';

export const registerSpendHandlers = (): void => {
  handleDb('spend:add', async (_event, input: AddSpendEventInput) => {
    return addSpendEvent(input);
  });

  handleDb('spend:getByGame', async (_event, gameId: number) => {
    return getSpendByGame(gameId);
  });

  handleDb('spend:delete', async (_event, id: number) => {
    return deleteSpendEvent(id);
  });

  handleDb('spend:update', async (_event, id: number, note: string | null) => {
    return updateSpendEvent(id, note);
  });
};
