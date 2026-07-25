import { desc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { SaveBackupRow } from '../../schema';
import { saveBackupColumns } from '../../projections';
import { saveBackupsTable } from '../../schema';

// Qué versiones hay en la nube de un juego. Sale ENTERO de la BD ya
// sincronizada: contestar "3 versiones, la última de hace 2 días desde
// PC-Jon" no cuesta ni una llamada de red (PARTIDAS-GUARDADAS.md §10bis.2).
// Descargar un zip solo pasa cuando el usuario pulsa restaurar.
export const getSaveBackups = async (gameId: number): Promise<SaveBackupRow[]> => {
  const db = getDb();
  return db
    .select(saveBackupColumns)
    .from(saveBackupsTable)
    .where(eq(saveBackupsTable.gameId, gameId))
    .orderBy(desc(saveBackupsTable.createdAt));
};
