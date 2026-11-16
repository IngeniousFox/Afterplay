import { invoke } from '../ipc';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../shared/types';
import type { SpendEventId } from '../../shared/entityIds';

export const spendApi = {
  add: (input: AddSpendEventInput): Promise<SpendEvent> => invoke('spend:add', input),
  getAll: (): Promise<SpendEventSummary[]> => invoke('spend:getAll'),
  delete: (id: SpendEventId): Promise<boolean> => invoke('spend:delete', id),
  update: (id: SpendEventId, patch: UpdateSpendEventPatch): Promise<SpendEvent | null> =>
    invoke('spend:update', id, patch),
};
