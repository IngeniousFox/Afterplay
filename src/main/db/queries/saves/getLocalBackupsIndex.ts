import { eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../..';
import { gamesTable, saveBackupsTable } from '../../schema';

// Lo mínimo que hace falta para saber qué zip local corresponde a qué fila
// del índice — usado por el mantenimiento de saves/localUsage.ts para
// decidir qué es seguro borrar de la carpeta local (lo que YA está reflejado
// en R2, según sus propias filas) sin ir a mirar R2 para nada.
export type OwnBackupEntry = {
  ludusaviName: string;
  backupName: string;
  sizeBytes: number;
};

// Todas las filas subidas por ESTA máquina — no por juego (getSaveBackups),
// sino la tabla entera filtrada por machineId. El índice es pequeño (cientos
// de filas incluso en una biblioteca grande de años), así que un escaneo
// completo aquí no cuesta nada y es más simple que ir juego a juego.
export const getOwnBackupEntries = async (machineId: string): Promise<OwnBackupEntry[]> => {
  const db = getDb();
  return db
    .select({
      ludusaviName: saveBackupsTable.ludusaviName,
      backupName: saveBackupsTable.backupName,
      sizeBytes: saveBackupsTable.sizeBytes,
    })
    .from(saveBackupsTable)
    .where(eq(saveBackupsTable.machineId, machineId));
};

// Todo nombre de ludusavi que el índice o la biblioteca actual reconocen, de
// CUALQUIER máquina — la lista blanca contra la que se decide qué carpeta de
// save-backups/ es huérfana de verdad (ninguna fila la referencia, ningún
// juego apunta a ella) y no un despiste de "ejecuta el barrido justo cuando
// aún no se ha subido nada".
export const getKnownLudusaviNames = async (): Promise<string[]> => {
  const db = getDb();
  const [fromBackups, fromGames] = await Promise.all([
    db.selectDistinct({ name: saveBackupsTable.ludusaviName }).from(saveBackupsTable),
    db
      .selectDistinct({ name: gamesTable.saveLudusaviName })
      .from(gamesTable)
      .where(isNotNull(gamesTable.saveLudusaviName)),
  ]);
  const names = new Set<string>();
  for (const row of fromBackups) names.add(row.name);
  for (const row of fromGames) if (row.name) names.add(row.name);
  return [...names];
};
