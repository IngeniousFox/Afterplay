import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdtempSync } from 'node:fs';
import { rmdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { createStorageClient } from './r2';
import type { StorageTarget } from './storageConfig';
import type { StorageMigrationProgress } from '../../shared/types';

type StoredObject = { key: string; size: number };

const listObjects = async (client: S3Client, bucket: string): Promise<StoredObject[]> => {
  const objects: StoredObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const entry of page.Contents ?? []) {
      if (!entry.Key) continue;
      if (entry.Size === undefined) throw new Error(`S3 did not report the size of ${entry.Key}.`);
      objects.push({ key: entry.Key, size: entry.Size });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !continuationToken) {
      throw new Error('S3 returned a truncated object list without a continuation token.');
    }
  } while (continuationToken);
  return objects;
};

const hashStream = async (stream: Readable): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
};

const hashFile = (path: string): Promise<string> => hashStream(createReadStream(path));

const hashObject = async (client: S3Client, bucket: string, key: string): Promise<string> => {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`S3 returned an empty body for ${key}.`);
  return hashStream(response.Body as Readable);
};

const cleanTemp = async (dir: string, file: string): Promise<void> => {
  if (
    dirname(resolve(dir)) !== resolve(tmpdir()) ||
    !/^afterplay-storage-migrate-[A-Za-z0-9]{6}$/.test(basename(dir)) ||
    resolve(file) !== resolve(dir, 'object.tmp')
  ) {
    throw new Error('Refusing to remove an unexpected migration temporary path.');
  }
  // Solo un fichero conocido y su directorio vacío; jamás una eliminación
  // recursiva de una ruta calculada a partir de claves del bucket.
  await unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rmdir(dir);
};

// Copia todos los objetos con sus claves intactas. Repetir tras un fallo es
// seguro: compara SHA-256 con los objetos ya presentes y solo resube los que
// faltan o difieren. No cambia el proveedor activo ni borra el origen.
export const migrateStorageObjects = async (
  source: StorageTarget,
  destination: StorageTarget,
  onProgress: (progress: StorageMigrationProgress) => void = () => {},
): Promise<{ copied: number; total: number }> => {
  if (source.identity === destination.identity) return { copied: 0, total: 0 };
  const sourceClient = createStorageClient(source);
  const destinationClient = createStorageClient(destination);
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-storage-migrate-'));
  const tempFile = join(dir, 'object.tmp');
  let copied = 0;

  try {
    onProgress({ phase: 'listing', completed: 0, total: 0, key: null });
    const sourceObjects = await listObjects(sourceClient, source.bucket);
    if (sourceObjects.length === 0) return { copied: 0, total: 0 };
    const destinationObjects = await listObjects(destinationClient, destination.bucket);
    const destinationSizes = new Map(destinationObjects.map((object) => [object.key, object.size]));
    const sourceHashes = new Map<string, string>();

    for (const [index, object] of sourceObjects.entries()) {
      onProgress({
        phase: 'copying',
        completed: index,
        total: sourceObjects.length,
        key: object.key,
      });
      const response = await sourceClient.send(
        new GetObjectCommand({ Bucket: source.bucket, Key: object.key }),
      );
      if (!response.Body) throw new Error(`Source returned an empty body for ${object.key}.`);
      await pipeline(response.Body as Readable, createWriteStream(tempFile));
      const actualSize = (await stat(tempFile)).size;
      if (actualSize !== object.size) {
        throw new Error(`Source size changed while copying ${object.key}.`);
      }
      const sourceHash = await hashFile(tempFile);
      sourceHashes.set(object.key, sourceHash);

      if (destinationSizes.has(object.key)) {
        const destinationHash = await hashObject(destinationClient, destination.bucket, object.key);
        if (destinationHash !== sourceHash) {
          throw new Error(
            `The two buckets contain different data at ${object.key}; nothing was overwritten.`,
          );
        }
      } else {
        await new Upload({
          client: destinationClient,
          params: {
            Bucket: destination.bucket,
            Key: object.key,
            Body: createReadStream(tempFile),
            ContentLength: actualSize,
            ContentType: response.ContentType ?? 'application/octet-stream',
          },
          queueSize: 2,
          partSize: 16 * 1024 * 1024,
          leavePartsOnError: false,
        }).done();
        copied++;
      }
      onProgress({
        phase: 'verifying',
        completed: index,
        total: sourceObjects.length,
        key: object.key,
      });
      const destinationHash = await hashObject(destinationClient, destination.bucket, object.key);
      if (destinationHash !== sourceHash) {
        throw new Error(`The copied object differs from the source: ${object.key}.`);
      }
      await unlink(tempFile);
      onProgress({
        phase: 'copying',
        completed: index + 1,
        total: sourceObjects.length,
        key: null,
      });
    }

    // Si otro PC escribió en el origen durante la copia, no se activa el
    // destino incompleto. El usuario puede repetirla tras cerrar ese PC.
    const finalSource = await listObjects(sourceClient, source.bucket);
    const original = new Map(sourceObjects.map((object) => [object.key, object.size]));
    if (
      finalSource.length !== sourceObjects.length ||
      finalSource.some((object) => original.get(object.key) !== object.size)
    ) {
      throw new Error(
        'The source bucket changed during migration. Retry after closing Afterplay on other PCs.',
      );
    }
    for (const object of finalSource) {
      const currentHash = await hashObject(sourceClient, source.bucket, object.key);
      if (currentHash !== sourceHashes.get(object.key)) {
        throw new Error(`The source changed during migration: ${object.key}.`);
      }
    }

    return { copied, total: sourceObjects.length };
  } finally {
    sourceClient.destroy();
    destinationClient.destroy();
    await cleanTemp(dir, tempFile);
  }
};
