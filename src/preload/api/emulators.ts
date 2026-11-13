import { ipcRenderer } from 'electron';
import type { CreateEmulatorInput, Emulator } from '../../shared/types';
import type { EmulatorId } from '../../shared/entityIds';

export const emulatorsApi = {
  getAll: (): Promise<Emulator[]> => ipcRenderer.invoke('emulators:getAll'),
  create: (input: CreateEmulatorInput): Promise<Emulator> =>
    ipcRenderer.invoke('emulators:create', input),
  delete: (id: EmulatorId): Promise<boolean> => ipcRenderer.invoke('emulators:delete', id),
};
