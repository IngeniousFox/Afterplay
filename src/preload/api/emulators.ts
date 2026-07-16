import { ipcRenderer } from 'electron';
import type { CreateEmulatorInput, Emulator } from '../../shared/types';

export const emulatorsApi = {
  getAll: (): Promise<Emulator[]> => ipcRenderer.invoke('emulators:getAll'),
  create: (input: CreateEmulatorInput): Promise<Emulator> =>
    ipcRenderer.invoke('emulators:create', input),
  delete: (id: number): Promise<boolean> => ipcRenderer.invoke('emulators:delete', id),
};
