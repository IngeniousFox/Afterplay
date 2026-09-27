import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launchAfterplay } from './fixtures';
import type { CredentialsValues } from '../src/shared/types';

const buckets = new Map<string, Map<string, Buffer>>();
const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const [, bucket, ...pieces] = decodeURIComponent(url.pathname).split('/');
  const key = pieces.join('/');
  const objects = buckets.get(bucket);
  if (!objects) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${[...objects].map(([name, body]) => `<Contents><Key>${name}</Key><Size>${body.length}</Size></Contents>`).join('')}</ListBucketResult>`,
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
  if (request.method === 'PUT') {
    objects.set(key, await readBody(request));
    response.writeHead(200, { etag: '"test"' });
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
test.beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fakeCredentials = (bucket: string): Partial<CredentialsValues> => ({
  r2AccountId: null,
  r2Bucket: null,
  r2AccessKeyId: null,
  r2SecretAccessKey: null,
  s3Endpoint: endpoint,
  s3Region: 'us-east-1',
  s3Bucket: bucket,
  s3AccessKeyId: 'test-key',
  s3SecretAccessKey: 'test-secret',
  s3AddressingMode: 'path',
});

test('existing Cloudflare credentials remain selected and unchanged', async () => {
  const {
    app,
    window: page,
    sandbox,
  } = await launchAfterplay({
    credentials: {
      r2AccountId: 'existing-account',
      r2Bucket: 'existing-bucket',
      r2AccessKeyId: 'existing-key',
      r2SecretAccessKey: 'existing-secret',
    },
  });
  try {
    const current = await page.evaluate(async () => ({
      provider: await globalThis.api.settings.getSaveStorageProvider(),
      credentials: await globalThis.api.settings.getCredentials(),
    }));
    expect(current.provider).toBe('cloudflare');
    expect(current.credentials.r2AccountId).toBe('existing-account');
    expect(current.credentials.r2Bucket).toBe('existing-bucket');
    expect(current.credentials.r2AccessKeyId).toBe('existing-key');
    expect(current.credentials.r2SecretAccessKey).toBe('existing-secret');

    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await expect(dialog.getByRole('button', { name: /Cloud saves.*Cloudflare R2/ })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'S3 compatible', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: /Cloud saves/ }).click();
    await expect(
      dialog.getByRole('button', { name: 'Cloudflare R2', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByText('ACCOUNT ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ENDPOINT URL', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Anthropic' }).click();
    await dialog.locator('input').fill('unrelated-setting');
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(dialog.getByText('Saved — applied immediately, no restart needed.')).toBeVisible();
    const saved = await page.evaluate(async () => ({
      provider: await globalThis.api.settings.getSaveStorageProvider(),
      credentials: await globalThis.api.settings.getCredentials(),
    }));
    expect(saved.provider).toBe('cloudflare');
    expect(saved.credentials.r2AccountId).toBe('existing-account');
    expect(saved.credentials.r2Bucket).toBe('existing-bucket');
    expect(saved.credentials.r2AccessKeyId).toBe('existing-key');
    expect(saved.credentials.r2SecretAccessKey).toBe('existing-secret');
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});

test('a new installation can choose S3 without a migration', async () => {
  buckets.clear();
  buckets.set('new', new Map());
  const {
    app,
    window: page,
    sandbox,
  } = await launchAfterplay({
    credentials: fakeCredentials('new'),
  });
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await dialog.getByRole('button', { name: /Cloud saves/ }).click();
    await dialog.getByRole('button', { name: 'S3 compatible', exact: true }).click();
    await expect(dialog.getByText('ENDPOINT URL', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ACCOUNT ID', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('select')).toHaveCount(0);
    const addressing = dialog.getByRole('combobox', { name: 'ADDRESSING' });
    await expect(addressing).toContainText('Path style');
    await addressing.click();
    await expect(page.getByRole('option', { name: 'Virtual host style' })).toBeVisible();
    await page.getByRole('option', { name: 'Virtual host style' }).click();
    await expect(addressing).toContainText('Virtual host style');
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(dialog.getByText('Saved — applied immediately, no restart needed.')).toBeVisible();
    await expect(dialog.getByText('Move cloud saves to the new destination?')).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: /Cloud saves.*S3 compatible.*Configured/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => globalThis.api.settings.getSaveStorageProvider())).toBe('s3');
    expect((await page.evaluate(() => globalThis.api.settings.getCredentials())).s3AddressingMode).toBe(
      'virtual',
    );
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});

test('changing an S3 bucket offers migration and activates it only after verified copy', async () => {
  buckets.clear();
  buckets.set('old', new Map([['machines/a.json', Buffer.from('{"machineId":"a"}')]]));
  buckets.set('new', new Map());
  const {
    app,
    window: page,
    sandbox,
  } = await launchAfterplay({
    saveStorageProvider: 's3',
    credentials: fakeCredentials('old'),
  });
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await dialog.getByRole('button', { name: /Cloud saves/ }).click();
    await dialog
      .getByText('BUCKET', { exact: true })
      .last()
      .locator('..')
      .locator('input')
      .fill('new');
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(dialog.getByText('Move cloud saves to the new destination?')).toBeVisible();

    const before = await page.evaluate(async () => ({
      provider: await globalThis.api.settings.getSaveStorageProvider(),
      bucket: (await globalThis.api.settings.getCredentials()).s3Bucket,
    }));
    expect(before).toEqual({ provider: 's3', bucket: 'old' });
    expect(buckets.get('new')?.size).toBe(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await page.evaluate(() => globalThis.api.settings.getCredentials())).s3Bucket).toBe(
      'old',
    );
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(dialog.getByText('Move cloud saves to the new destination?')).toBeVisible();

    await dialog.getByRole('button', { name: 'Migrate backups and switch' }).click();
    await expect(dialog.getByText('Saved — applied immediately, no restart needed.')).toBeVisible();
    const after = await page.evaluate(async () => ({
      provider: await globalThis.api.settings.getSaveStorageProvider(),
      bucket: (await globalThis.api.settings.getCredentials()).s3Bucket,
    }));
    expect(after).toEqual({ provider: 's3', bucket: 'new' });
    assert.deepEqual(
      buckets.get('new')?.get('machines/a.json'),
      buckets.get('old')?.get('machines/a.json'),
    );
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});

test('a conflicting object keeps the old bucket active and leaves both copies untouched', async () => {
  buckets.clear();
  buckets.set('old', new Map([['saves/1/a.zip', Buffer.from('original')]]));
  buckets.set('new', new Map([['saves/1/a.zip', Buffer.from('different')]]));
  const {
    app,
    window: page,
    sandbox,
  } = await launchAfterplay({
    saveStorageProvider: 's3',
    credentials: fakeCredentials('old'),
  });
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await dialog.getByRole('button', { name: /Cloud saves/ }).click();
    await dialog
      .getByText('BUCKET', { exact: true })
      .last()
      .locator('..')
      .locator('input')
      .fill('new');
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await dialog.getByRole('button', { name: 'Migrate backups and switch' }).click();
    await expect(dialog.getByText(/Couldn.t save.*different data/i)).toBeVisible();

    const saved = await page.evaluate(async () => ({
      provider: await globalThis.api.settings.getSaveStorageProvider(),
      bucket: (await globalThis.api.settings.getCredentials()).s3Bucket,
    }));
    expect(saved).toEqual({ provider: 's3', bucket: 'old' });
    assert.equal(buckets.get('old')?.get('saves/1/a.zip')?.toString(), 'original');
    assert.equal(buckets.get('new')?.get('saves/1/a.zip')?.toString(), 'different');
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});
