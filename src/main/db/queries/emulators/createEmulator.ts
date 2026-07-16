import { getDb } from '../..';
import type { CreateEmulatorInput, Emulator } from '../../../../shared/types';
import { emulatorColumns } from '../../projections';
import { emulatorsTable } from '../../schema';

// Registrar un emulador para que el watcher lo vigile — mismo papel que el
// executablePath de un juego nativo, solo que la sesión detectada nacerá sin
// juego asignado (ver createEmulatorSession).
export const createEmulator = async (input: CreateEmulatorInput): Promise<Emulator> => {
  const db = getDb();
  const [emulator] = await db.insert(emulatorsTable).values(input).returning(emulatorColumns);
  return emulator;
};
