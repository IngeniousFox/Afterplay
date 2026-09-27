import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { desc } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { saveBackupsTable } from '../db/schema';
import { MAPPING_FILE } from './mapping';
import { createStorageClient } from './r2';
import {
  clearRestoreWorkspace,
  createRestoreWorkspace,
  restoreGame,
  sanitizeLudusaviFolder,
} from './service';
import type { StorageTarget } from './storageConfig';

// Una copia byte a byte no prueba que Ludusavi entienda el mapping y su ZIP.
// Con la versión más reciente del índice se prepara un workspace desechable
// DESDE EL DESTINO y se ejecuta el preview de restore (sin tocar partidas).
export const verifyMigratedRestore = async (destination: StorageTarget): Promise<void> => {
  const [backup] = await withDbAccess(async () =>
    getDb()
      .select({
        r2Key: saveBackupsTable.r2Key,
        backupName: saveBackupsTable.backupName,
        parentBackupName: saveBackupsTable.parentBackupName,
        ludusaviName: saveBackupsTable.ludusaviName,
      })
      .from(saveBackupsTable)
      .orderBy(desc(saveBackupsTable.createdAt))
      .limit(1),
  );
  if (!backup) return;

  const slash = backup.r2Key.lastIndexOf('/');
  if (slash < 0) throw new Error('A backup index entry has no object prefix.');
  const prefix = backup.r2Key.slice(0, slash + 1);
  if (`${prefix}${backup.backupName}` !== backup.r2Key) {
    throw new Error('A backup index entry does not match its object key.');
  }
  const workspace = createRestoreWorkspace(backup.ludusaviName);
  const gameDir = join(workspace, sanitizeLudusaviFolder(backup.ludusaviName));
  const client = createStorageClient(destination);
  try {
    const names = [MAPPING_FILE, backup.parentBackupName, backup.backupName].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of new Set(names)) {
      if (basename(name) !== name || name === '.' || name === '..') {
        throw new Error('A backup index entry contains an unsafe filename.');
      }
      const response = await client.send(
        new GetObjectCommand({ Bucket: destination.bucket, Key: `${prefix}${name}` }),
      );
      if (!response.Body) throw new Error(`S3 returned an empty body for ${prefix}${name}.`);
      await pipeline(response.Body as Readable, createWriteStream(join(gameDir, name)));
    }
    await restoreGame({
      ludusaviName: backup.ludusaviName,
      restoreRoot: workspace,
      backupName: backup.backupName,
      preview: true,
      redirects: [],
      skipRegistryKeys: ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE'],
    });
  } finally {
    client.destroy();
    clearRestoreWorkspace(workspace);
  }
};
