import { invoke } from '../ipc';
import type {
  AddStateEventInput,
  StateEvent,
  StateEventSummary,
  UpdateStateEventPatch,
} from '../../shared/types';
import type { StateEventId } from '../../shared/entityIds';

export const stateEventsApi = {
  add: (input: AddStateEventInput): Promise<StateEvent> => invoke('stateEvents:add', input),
  getAll: (): Promise<StateEventSummary[]> => invoke('stateEvents:getAll'),
  update: (id: StateEventId, patch: UpdateStateEventPatch): Promise<StateEvent | null> =>
    invoke('stateEvents:update', id, patch),
  delete: (id: StateEventId): Promise<boolean> => invoke('stateEvents:delete', id),
};
