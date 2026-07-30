import { handleDb } from './dbHandle';
import type { AddStateEventInput, UpdateStateEventPatch } from '../../shared/types';
import { addStateEventWithResult } from '../db/queries/stateEvents/addStateEvent';
import { deleteStateEvent } from '../db/queries/stateEvents/deleteStateEvent';
import { getAllStateEvents } from '../db/queries/stateEvents/getAllStateEvents';
import { updateStateEvent } from '../db/queries/stateEvents/updateStateEvent';
import {
  applySessionFinalizationEffects,
  describeFinalizedSession,
} from '../sessions/finalizeSession';

export const registerStateEventsHandlers = (): void => {
  handleDb('stateEvents:add', async (_event, input: AddStateEventInput) => {
    const result = await addStateEventWithResult(input);
    if (result.closedSession) {
      const finalization = await describeFinalizedSession(result.closedSession, 'terminal_state');
      await applySessionFinalizationEffects(finalization);
    }
    return result.event;
  });

  handleDb('stateEvents:getAll', async () => {
    return getAllStateEvents();
  });

  handleDb('stateEvents:update', async (_event, id: number, patch: UpdateStateEventPatch) => {
    return updateStateEvent(id, patch);
  });

  handleDb('stateEvents:delete', async (_event, id: number) => {
    return deleteStateEvent(id);
  });
};
