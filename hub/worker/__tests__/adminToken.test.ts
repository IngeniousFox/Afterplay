import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessError } from '../src/access';
import { ADMIN_TOKEN_HEADER, authenticateAdminToken } from '../src/adminToken';

const TOKEN = 'a'.repeat(20) + 'b'.repeat(20);
const request = (token?: string): Request =>
  new Request('https://hub.example/api/v2/devices', {
    headers: token === undefined ? {} : { [ADMIN_TOKEN_HEADER]: token },
  });

describe('token de administración de /api/v2', () => {
  it('sin la cabecera no decide nada: sigue Access', async () => {
    assert.equal(
      await authenticateAdminToken(request(), { HUB_ADMIN_TOKEN: TOKEN, ADMIN_EMAIL: 'a@b.c' }),
      null,
    );
  });

  it('con el token correcto actúa como el anfitrión', async () => {
    assert.deepEqual(
      await authenticateAdminToken(request(TOKEN), {
        HUB_ADMIN_TOKEN: TOKEN,
        ADMIN_EMAIL: 'host@example.com',
      }),
      { email: 'host@example.com' },
    );
  });

  it('falla cerrado: token distinto, secret sin poner, secret corto o sin anfitrión', async () => {
    const cases: [string, { HUB_ADMIN_TOKEN?: string; ADMIN_EMAIL?: string }][] = [
      [TOKEN + 'x', { HUB_ADMIN_TOKEN: TOKEN, ADMIN_EMAIL: 'a@b.c' }],
      [TOKEN, { ADMIN_EMAIL: 'a@b.c' }],
      ['corto', { HUB_ADMIN_TOKEN: 'corto', ADMIN_EMAIL: 'a@b.c' }],
      [TOKEN, { HUB_ADMIN_TOKEN: TOKEN }],
      ['', { HUB_ADMIN_TOKEN: TOKEN, ADMIN_EMAIL: 'a@b.c' }],
    ];
    for (const [token, env] of cases) {
      await assert.rejects(authenticateAdminToken(request(token), env), AccessError);
    }
  });
});
