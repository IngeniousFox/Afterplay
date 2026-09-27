import type { CredentialsValues, SaveStorageProvider } from '../../shared/types';

export type StorageTarget = {
  provider: SaveStorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  // No contiene secretos; se compara para detectar cambios de servidor o bucket.
  identity: string;
};

const nonEmpty = (value: string | null | undefined): string => value?.trim() ?? '';

const normalizeEndpoint = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid S3 endpoint URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('The S3 endpoint must be an HTTP(S) server URL without a path or query.');
  }
  return url.origin;
};

export const storageTargetFrom = (
  provider: SaveStorageProvider,
  values: Partial<CredentialsValues>,
): StorageTarget | null => {
  if (provider === 'cloudflare') {
    const accountId = nonEmpty(values.r2AccountId);
    const bucket = nonEmpty(values.r2Bucket);
    const accessKeyId = nonEmpty(values.r2AccessKeyId);
    const secretAccessKey = nonEmpty(values.r2SecretAccessKey);
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    return {
      provider,
      endpoint,
      region: 'auto',
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: false,
      identity: JSON.stringify([provider, endpoint.toLowerCase(), bucket]),
    };
  }

  const rawEndpoint = nonEmpty(values.s3Endpoint);
  const region = nonEmpty(values.s3Region);
  const bucket = nonEmpty(values.s3Bucket);
  const accessKeyId = nonEmpty(values.s3AccessKeyId);
  const secretAccessKey = nonEmpty(values.s3SecretAccessKey);
  if (!rawEndpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = normalizeEndpoint(rawEndpoint);
  const addressing = nonEmpty(values.s3AddressingMode) || 'path';
  if (addressing !== 'path' && addressing !== 'virtual') {
    throw new Error('S3 addressing must be path or virtual.');
  }
  return {
    provider,
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: addressing === 'path',
    identity: JSON.stringify([provider, endpoint.toLowerCase(), bucket]),
  };
};

export const storageTargetFromEnv = (provider: SaveStorageProvider): StorageTarget | null =>
  storageTargetFrom(provider, {
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2Bucket: process.env.R2_BUCKET,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION,
    s3Bucket: process.env.S3_BUCKET,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3AddressingMode: process.env.S3_ADDRESSING_MODE,
  });

export const destinationChanged = (from: StorageTarget | null, to: StorageTarget | null): boolean =>
  from?.identity !== to?.identity;
