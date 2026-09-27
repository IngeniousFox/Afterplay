import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, it, mock } from 'node:test';
import { saveBackupsTable } from '../../db/schema';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { storageTargetFrom } from '../storageConfig';

const workspace = mkdtempSync(join(tmpdir(), 'afterplay-test-'));
let previewCalled = false;
mock.module('../service', {
  namedExports: {
    createRestoreWorkspace: (): string => {
      mkdirSync(join(workspace, 'Test Game'), { recursive: true });
      return workspace;
    },
    clearRestoreWorkspace: (): void => {},
    sanitizeLudusaviFolder: (): string => 'Test Game',
    restoreGame: async (options: {
      preview: boolean;
      backupName: string;
    }): Promise<{
      files: never[];
      registryKeys: never[];
      totalBytes: number;
    }> => {
      previewCalled = options.preview;
      assert.equal(options.backupName, 'backup-diff.zip');
      assert.equal(readFileSync(join(workspace, 'Test Game', 'mapping.yaml'), 'utf8'), 'mapping');
      assert.equal(readFileSync(join(workspace, 'Test Game', 'backup-full.zip'), 'utf8'), 'full');
      assert.equal(readFileSync(join(workspace, 'Test Game', 'backup-diff.zip'), 'utf8'), 'diff');
      return { files: [], registryKeys: [], totalBytes: 0 };
    },
  },
});

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const key = decodeURIComponent(url.pathname).replace(/^\/bucket\//, '');
  const objects = new Map([
    ['saves/1/machine/mapping.yaml', 'mapping'],
    ['saves/1/machine/backup-full.zip', 'full'],
    ['saves/1/machine/backup-diff.zip', 'diff'],
  ]);
  const body = objects.get(key);
  if (!body) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-length': Buffer.byteLength(body) });
  response.end(body);
});
let endpoint: string;
let db: TestDb;
let verifyMigratedRestore: typeof import('../verifyStorageRestore').verifyMigratedRestore;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ verifyMigratedRestore } = await import('../verifyStorageRestore'));
});
beforeEach(async () => {
  db = await freshDb();
  previewCalled = false;
});
after(() => {
  server.close();
  cleanupDbs();
});

it('downloads a differential chain from the destination and previews restore without writing saves', async () => {
  const gameId = await makeGame(db);
  await db.insert(saveBackupsTable).values({
    gameId,
    backupName: 'backup-diff.zip',
    parentBackupName: 'backup-full.zip',
    differential: true,
    r2Key: 'saves/1/machine/backup-diff.zip',
    ludusaviName: 'Test Game',
    machineId: 'machine',
    machineName: 'Test PC',
    machineHome: 'C:/Users/Test',
  });
  const target = storageTargetFrom('s3', {
    s3Endpoint: endpoint,
    s3Region: 'us-east-1',
    s3Bucket: 'bucket',
    s3AccessKeyId: 'key',
    s3SecretAccessKey: 'secret',
  });
  if (!target) throw new Error('test S3 destination missing');

  await verifyMigratedRestore(target);

  assert.equal(previewCalled, true);
  assert.equal(existsSync(join(workspace, 'Test Game', 'backup-diff.zip')), true);
});
