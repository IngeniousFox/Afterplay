import { inArray } from 'drizzle-orm';
import { getDb } from '../..';
import { saveBackupsTable } from '../../schema';

// Poda del índice cuando una versión desaparece de R2 (retención) o cuando
// el usuario borra una a mano. Solo toca la BD: quien borra el objeto del
// bucket es ipc/saves.ts, y en ese orden — primero el bucket, luego el
// índice, para que un fallo a medias deje como mucho un registro que apunta
// a algo que ya no está (visible y recuperable) y nunca un objeto huérfano
// pagando espacio sin que nada lo liste.
export const deleteSaveBackups = async (ids: number[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const db = getDb();
  const deleted = await db
    .delete(saveBackupsTable)
    .where(inArray(saveBackupsTable.id, ids))
    .returning({ id: saveBackupsTable.id });
  return deleted.length;
};
