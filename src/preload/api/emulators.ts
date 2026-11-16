import { invoke } from '../ipc';
import type { CreateEmulatorInput, Emulator } from '../../shared/types';
import type { EmulatorId } from '../../shared/entityIds';

export const emulatorsApi = {
  getAll: (): Promise<Emulator[]> => invoke('emulators:getAll'),
  create: (input: CreateEmulatorInput): Promise<Emulator> => invoke('emulators:create', input),
  delete: (id: EmulatorId): Promise<boolean> => invoke('emulators:delete', id),
};
