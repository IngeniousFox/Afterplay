import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { after, before, beforeEach, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { migrateStorageObjects } from '../migrateStorage';
import { storageTargetFrom } from '../storageConfig';
import type { StorageTarget } from '../storageConfig';

const buckets = new Map<string, Map<string, Buffer>>();
const parts = new Map<string, Map<number, Buffer>>();
let multipartUploads = 0;
let signedRequests = 0;

const xml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  if (request.headers.authorization) signedRequests++;
  const url = new URL(request.url ?? '/', 'http://localhost');
  const [, bucket, ...keyParts] = decodeURIComponent(url.pathname).split('/');
  const key = keyParts.join('/');
  const objects = buckets.get(bucket);
  if (!objects) {
    response.writeHead(404);
    response.end();
    return;
  }

  if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
    const keys = [...objects.keys()].sort();
    const start = Number(url.searchParams.get('continuation-token') ?? '0');
    const page = keys.slice(start, start + 1);
    const next = start + page.length;
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xml(bucket)}</Name><IsTruncated>${next < keys.length}</IsTruncated>${next < keys.length ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}${page.map((name) => `<Contents><Key>${xml(name)}</Key><Size>${objects.get(name)?.length ?? 0}</Size></Contents>`).join('')}</ListBucketResult>`,
    );
    return;
  }
  if (request.method === 'GET') {
    const body = objects.get(key);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-length': body.length,
      'content-type': 'application/octet-stream',
    });
    response.end(body);
    return;
  }
  if (request.method === 'POST' && url.searchParams.has('uploads')) {
    multipartUploads++;
    const uploadId = `test-${multipartUploads}`;
    parts.set(uploadId, new Map());
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(
      `<InitiateMultipartUploadResult><Bucket>${xml(bucket)}</Bucket><Key>${xml(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
    );
    return;
  }
  const uploadId = url.searchParams.get('uploadId');
  if (request.method === 'PUT' && uploadId) {
    const partNumber = Number(url.searchParams.get('partNumber'));
    const body = await readBody(request);
    parts.get(uploadId)?.set(partNumber, body);
    response.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
    response.end();
    return;
  }
  if (request.method === 'POST' && uploadId) {
    await readBody(request);
    const body = Buffer.concat(
      [...(parts.get(uploadId)?.entries() ?? [])]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value),
    );
    objects.set(key, body);
    parts.delete(uploadId);
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(
      `<CompleteMultipartUploadResult><Bucket>${xml(bucket)}</Bucket><Key>${xml(key)}</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>`,
    );
    return;
  }
  if (request.method === 'DELETE' && uploadId) {
    parts.delete(uploadId);
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'PUT') {
    objects.set(key, await readBody(request));
    response.writeHead(200, { etag: '"small"' });
    response.end();
    return;
  }
  response.writeHead(405);
  response.end();
};

const server = createServer((request, response) => {
  void respond(request, response).catch((error) => {
    response.writeHead(500);
    response.end(String(error));
  });
});
let endpoint: string;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  buckets.clear();
  buckets.set('old', new Map());
  buckets.set('new', new Map());
  parts.clear();
  multipartUploads = 0;
  signedRequests = 0;
});
after(() => server.close());

const target = (bucket: string): StorageTarget => {
  const result = storageTargetFrom('s3', {
    s3Endpoint: endpoint,
    s3Region: 'us-east-1',
    s3Bucket: bucket,
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3AddressingMode: 'path',
  });
  if (!result) throw new Error('test target missing');
  return result;
};

it('copies and hashes every object with pagination and multipart, then retries without writing', async () => {
  const big = Buffer.alloc(17 * 1024 * 1024, 0x71);
  buckets.get('old')?.set('machines/a.json', Buffer.from('{"machineId":"a"}'));
  buckets.get('old')?.set('saves/1/a.zip', Buffer.from('small backup'));
  buckets.get('old')?.set('saves/1/big.zip', big);
  buckets.get('new')?.set('unrelated.txt', Buffer.from('keep me'));

  const first = await migrateStorageObjects(target('old'), target('new'));
  assert.deepEqual(first, { copied: 3, total: 3 });
  assert.ok(multipartUploads > 0, 'large backup must use multipart');
  assert.ok(signedRequests > 0, 'SDK requests must be signed');
  for (const [key, value] of buckets.get('old') ?? []) {
    assert.deepEqual(buckets.get('new')?.get(key), value);
  }
  assert.equal(buckets.get('new')?.get('unrelated.txt')?.toString(), 'keep me');

  const second = await migrateStorageObjects(target('old'), target('new'));
  assert.deepEqual(second, { copied: 0, total: 3 });
});

it('stops on a conflicting key without overwriting either bucket', async () => {
  buckets.get('old')?.set('saves/1/a.zip', Buffer.from('original'));
  buckets.get('new')?.set('saves/1/a.zip', Buffer.from('different'));

  await assert.rejects(migrateStorageObjects(target('old'), target('new')), /different data/);
  assert.equal(buckets.get('old')?.get('saves/1/a.zip')?.toString(), 'original');
  assert.equal(buckets.get('new')?.get('saves/1/a.zip')?.toString(), 'different');
});

it('stops if another writer changes the source during migration', async () => {
  buckets.get('old')?.set('saves/1/a.zip', Buffer.from('original'));
  await assert.rejects(
    migrateStorageObjects(target('old'), target('new'), (progress) => {
      if (progress.phase === 'copying' && progress.completed === 1) {
        buckets.get('old')?.set('saves/1/a.zip', Buffer.from('modified'));
      }
    }),
    /source changed/i,
  );
  assert.equal(buckets.get('new')?.get('saves/1/a.zip')?.toString(), 'original');
});

it('can copy from the R2 client configuration into a private S3 destination', async () => {
  buckets.get('old')?.set('saves/42/machine/backup.zip', Buffer.from('cloudflare-backup'));
  const source: StorageTarget = {
    ...target('old'),
    provider: 'cloudflare',
    region: 'auto',
    forcePathStyle: false,
    identity: 'cloudflare-test-source',
  };

  const result = await migrateStorageObjects(source, target('new'));

  assert.deepEqual(result, { copied: 1, total: 1 });
  assert.equal(
    buckets.get('new')?.get('saves/42/machine/backup.zip')?.toString(),
    'cloudflare-backup',
  );
  assert.equal(
    buckets.get('old')?.get('saves/42/machine/backup.zip')?.toString(),
    'cloudflare-backup',
  );
});
