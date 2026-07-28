import { sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { SaveBackupsUsage } from '../../../saves/contracts';
import { saveBackupsTable } from '../../schema';

// Cuánto ocupa Cloud saves en R2 — SIN pedirle nada a R2. sizeBytes ya se
// guarda por fila al subir cada zip (uploadFile devuelve los bytes REALES
// escritos), y el índice se poda en el mismo commit que borra el objeto del
// bucket (deleteSaveBackups) — la suma local coincide con lo que hay arriba
// sin gastar ni una sola llamada de lectura contra R2.
export const getSaveBackupsUsage = async (): Promise<SaveBackupsUsage> => {
  const db = getDb();
  const [row] = await db
    .select({
      totalBytes: sql<number>`coalesce(sum(${saveBackupsTable.sizeBytes}), 0)`,
      backupCount: sql<number>`count(*)`,
    })
    .from(saveBackupsTable);
  return row ?? { totalBytes: 0, backupCount: 0 };
};
