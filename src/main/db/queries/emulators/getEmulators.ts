import { sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { Emulator } from '../../../../shared/types';
import { emulatorColumns } from '../../projections';
import { emulatorsTable } from '../../schema';

export const getEmulators = async (): Promise<Emulator[]> => {
  const db = getDb();
  return db
    .select(emulatorColumns)
    .from(emulatorsTable)
    .orderBy(sql`${emulatorsTable.name} collate nocase`);
};
