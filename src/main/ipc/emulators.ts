import { handle } from './contractHandlers';
import type { CreateEmulatorInput } from '../../shared/types';
import { appCtx } from '../db/v2/appDb';
import { createEmulator, deleteEmulator, getEmulators } from '../db/v2/queries/sessions';
import type { EmulatorId } from '../../shared/entityIds';

// EMULADORES.md — registro de emuladores (Ajustes). El watcher los vigila
// con el mismo barrido que los juegos; ver getWatchTargets.
export const registerEmulatorsHandlers = (): void => {
  handle('emulators:getAll', async () => {
    return getEmulators(appCtx());
  });

  handle('emulators:create', async (_event, input: CreateEmulatorInput) => {
    return createEmulator(appCtx(), input);
  });

  handle('emulators:delete', async (_event, id: EmulatorId) => {
    return deleteEmulator(appCtx(), id);
  });
};
