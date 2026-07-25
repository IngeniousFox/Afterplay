import { getDb } from '../..';
import { saveBackupColumns } from '../../projections';
import type { NewSaveBackup, SaveBackupRow } from '../../schema';
import { saveBackupsTable } from '../../schema';

export const createSaveBackup = async (input: NewSaveBackup): Promise<SaveBackupRow> => {
  const db = getDb();
  const [created] = await db.insert(saveBackupsTable).values(input).returning(saveBackupColumns);
  return created;
};
