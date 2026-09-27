import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destinationChanged, storageTargetFrom } from '../storageConfig';

const r2 = {
  r2AccountId: 'account123',
  r2Bucket: 'afterplay',
  r2AccessKeyId: 'key',
  r2SecretAccessKey: 'secret',
};

describe('local cloud save destinations', () => {
  it('keeps the existing Cloudflare endpoint, region, bucket and addressing', () => {
    const target = storageTargetFrom('cloudflare', r2);
    assert.equal(target?.endpoint, 'https://account123.r2.cloudflarestorage.com');
    assert.equal(target?.region, 'auto');
    assert.equal(target?.bucket, 'afterplay');
    assert.equal(target?.forcePathStyle, false);
  });

  it('detects a bucket or server change but ignores key rotation', () => {
    const current = storageTargetFrom('cloudflare', r2);
    const rotated = storageTargetFrom('cloudflare', { ...r2, r2SecretAccessKey: 'new-secret' });
    const bucket = storageTargetFrom('cloudflare', { ...r2, r2Bucket: 'new-bucket' });
    const server = storageTargetFrom('cloudflare', { ...r2, r2AccountId: 'other-account' });
    assert.equal(destinationChanged(current, rotated), false);
    assert.equal(destinationChanged(current, bucket), true);
    assert.equal(destinationChanged(current, server), true);
  });

  it('normalizes S3 endpoints and uses path style by default', () => {
    const target = storageTargetFrom('s3', {
      s3Endpoint: 'https://s3.plexy.es/',
      s3Region: 'us-east-1',
      s3Bucket: 'afterplay',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
    });
    assert.equal(target?.endpoint, 'https://s3.plexy.es');
    assert.equal(target?.forcePathStyle, true);
    assert.equal(target?.identity, JSON.stringify(['s3', 'https://s3.plexy.es', 'afterplay']));
  });

  it('rejects S3 endpoints with a path or embedded credentials', () => {
    const base = {
      s3Region: 'us-east-1',
      s3Bucket: 'afterplay',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
    };
    assert.throws(() => storageTargetFrom('s3', { ...base, s3Endpoint: 'https://host/path' }));
    assert.throws(() => storageTargetFrom('s3', { ...base, s3Endpoint: 'https://user:pw@host' }));
  });
});
