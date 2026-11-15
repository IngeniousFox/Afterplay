import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SyncErrorCode } from '../../../src/shared/sync/protocol';
import { AccessError, authenticate } from '../src/access';
import { classifyUnexpected, errorResponse, statusFor } from '../src/errors';

describe('error -> HTTP', () => {
  it('cada código del protocolo tiene el estado que documenta protocol.ts', () => {
    const expected: Record<SyncErrorCode, number> = {
      unauthorized: 401,
      protocol_mismatch: 426,
      schema_too_old: 426,
      quota_exceeded: 503,
      invalid_request: 400,
      enroll_code_invalid: 400,
      not_found: 404,
      rate_limited: 429,
      forbidden: 403,
      conflict: 409,
      igdb_not_configured: 409,
      igdb_unavailable: 502,
      internal: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      assert.equal(statusFor(code as SyncErrorCode), status, code);
    }
  });

  it('conserva minSchema en el cuerpo y no cachea', async () => {
    const response = errorResponse({ error: 'schema_too_old', message: 'x', minSchema: 7 });
    assert.equal(response.status, 426);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'schema_too_old',
      message: 'x',
      minSchema: 7,
    });
  });

  it('un error inesperado no filtra su mensaje', () => {
    const body = classifyUnexpected(new Error('SELECT * FROM secretos en C:\\x'));
    assert.deepEqual(body, { error: 'internal', message: 'error interno del hub' });
    assert.equal(classifyUnexpected('Exceeded allowed rows read').error, 'quota_exceeded');
  });
});

describe('Access (copia de worker/src/access.ts): falla cerrado', () => {
  const request = new Request('https://hub.test/api/v2/devices');

  it('sin configuración de Access no se valida nada', async () => {
    await assert.rejects(authenticate(request, {}, Date.now()), AccessError);
  });

  it('con configuración pero sin token, tampoco', async () => {
    await assert.rejects(
      authenticate(
        request,
        { ACCESS_TEAM_DOMAIN: 'team.example.com', ACCESS_AUD: 'aud' },
        Date.now(),
      ),
      AccessError,
    );
  });

  it('un token mal formado es AccessError, no un 500', async () => {
    const bad = new Request('https://hub.test/', {
      headers: { 'cf-access-jwt-assertion': 'a.b.c' },
    });
    await assert.rejects(
      authenticate(bad, { ACCESS_TEAM_DOMAIN: 'team.example.com', ACCESS_AUD: 'aud' }, Date.now()),
      AccessError,
    );
  });

  it('el modo desarrollo exige DEV_EMAIL y solo existe con ENVIRONMENT=development', async () => {
    await assert.rejects(
      authenticate(request, { ENVIRONMENT: 'development' }, Date.now()),
      AccessError,
    );
    const identity = await authenticate(
      request,
      { ENVIRONMENT: 'development', DEV_EMAIL: 'Yo@Example.com' },
      Date.now(),
    );
    assert.equal(identity.email, 'yo@example.com');
    await assert.rejects(
      authenticate(request, { DEV_EMAIL: 'yo@example.com' }, Date.now()),
      AccessError,
    );
  });
});
