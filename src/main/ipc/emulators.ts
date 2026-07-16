import { handleDb } from './dbHandle';
import type { CreateEmulatorInput } from '../../shared/types';
import { createEmulator } from '../db/queries/emulators/createEmulator';
import { deleteEmulator } from '../db/queries/emulators/deleteEmulator';
import { getEmulators } from '../db/queries/emulators/getEmulators';

// EMULADORES.md — registro de emuladores (Ajustes). El watcher los vigila
// con el mismo barrido que los juegos; ver getWatchTargets.
export const registerEmulatorsHandlers = (): void => {
  handleDb('emulators:getAll', async () => {
    return getEmulators();
  });

  handleDb('emulators:create', async (_event, input: CreateEmulatorInput) => {
    return createEmulator(input);
  });

  handleDb('emulators:delete', async (_event, id: number) => {
    return deleteEmulator(id);
  });
};
