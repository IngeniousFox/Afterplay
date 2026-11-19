import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ApiFailure,
  createEnrollCode,
  fetchDevices,
  fetchMe,
  inviteByEmail,
  revokeDevice,
} from '../api';
import type { DeviceDto } from '../api';
import {
  activeDevices,
  deviceSeenLabel,
  formatCountdown,
  inviteErrorMessage,
} from '../lib/account';

// Los clientes de Ajustes (/me, emparejado, dispositivos, invitaciones) contra
// un `fetch` falso, y los textos que se derivan de sus respuestas.

type Call = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (respond: (call: Call) => Response): Call[] => {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const failure = async (promise: Promise<unknown>): Promise<ApiFailure> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiFailure, 'se esperaba un ApiFailure');
    return error;
  }
  throw new Error('se esperaba un fallo');
};

const device = (patch: Partial<DeviceDto> = {}): DeviceDto => ({
  tokenId: 't1',
  deviceId: 'd1',
  deviceName: 'Desktop',
  shortDeviceId: 'ABCD',
  createdAt: Date.UTC(2026, 0, 5, 12),
  lastUsedAt: null,
  revokedAt: null,
  ...patch,
});

describe('clientes de Ajustes', () => {
  it('lee /me', async () => {
    const calls = stub(() => json({ email: 'host@example.com', isHost: true }));
    assert.deepEqual(await fetchMe(), { email: 'host@example.com', isHost: true });
    assert.equal(calls[0].url, '/api/v2/me');
    assert.equal(calls[0].init.method, 'GET');
  });

  it('pide un código de emparejado con POST', async () => {
    const calls = stub(() => json({ code: 'ab12-K7M2P-9XQ4T', expiresAt: 123 }));
    assert.deepEqual(await createEnrollCode(), { code: 'ab12-K7M2P-9XQ4T', expiresAt: 123 });
    assert.equal(calls[0].url, '/api/v2/devices/enroll-code');
    assert.equal(calls[0].init.method, 'POST');
  });

  it('lista los dispositivos', async () => {
    const calls = stub(() => json([device()]));
    assert.equal((await fetchDevices()).length, 1);
    assert.equal(calls[0].url, '/api/v2/devices');
  });

  it('revoca con el id codificado', async () => {
    const calls = stub(() => json({ revoked: true }));
    await revokeDevice('a/b');
    assert.equal(calls[0].url, '/api/v2/devices/a%2Fb/revoke');
    assert.equal(calls[0].init.method, 'POST');
  });

  it('invita con el correo en el cuerpo', async () => {
    const calls = stub(() =>
      json(
        {
          email: 'ana@example.com',
          invitedBy: 'host@example.com',
          createdAt: 1,
          expiresAt: 2,
          acceptedAt: null,
        },
        201,
      ),
    );
    await inviteByEmail('ana@example.com');
    assert.equal(calls[0].url, '/api/v2/invitations');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { email: 'ana@example.com' });
  });
});

describe('errores de una invitación', () => {
  const codes = [
    [400, 'invalid_request', "That doesn't look like a valid email address."],
    [409, 'conflict', 'That person already has their own Afterplay space.'],
    [403, 'forbidden', 'Only the owner of this Afterplay can invite people.'],
  ] as const;

  for (const [status, code, message] of codes) {
    it(`${status} ${code} se enseña en inglés, no el texto del hub`, async () => {
      stub(() => json({ error: code, message: 'texto en español del hub' }, status));
      const error = await failure(inviteByEmail('x@example.com'));
      assert.equal(error.code, code);
      assert.equal(inviteErrorMessage(error), message);
    });
  }

  it('un fallo de red usa su propio mensaje', () => {
    assert.equal(
      inviteErrorMessage(new ApiFailure('network', "Couldn't reach Afterplay.")),
      "Couldn't reach Afterplay.",
    );
    assert.equal(inviteErrorMessage(new Error('x')), 'Something went wrong. Try again.');
  });
});

describe('textos de dispositivos y cuenta atrás', () => {
  it('oculta los dispositivos revocados', () => {
    const list = [device(), device({ tokenId: 't2', revokedAt: 5 })];
    assert.deepEqual(
      activeDevices(list).map((d) => d.tokenId),
      ['t1'],
    );
  });

  it('un PC que nunca ha sincronizado dice cuándo se añadió', () => {
    assert.match(deviceSeenLabel(device()), /^Added .*2026.*, hasn't synced yet$/);
  });

  it('un PC visto hoy dice "last seen today"', () => {
    assert.equal(deviceSeenLabel(device({ lastUsedAt: Date.now() })), 'Last seen today');
  });

  it('la cuenta atrás va en m:ss y redondea hacia arriba', () => {
    assert.equal(formatCountdown(10 * 60_000), '10:00');
    assert.equal(formatCountdown(65_000), '1:05');
    assert.equal(formatCountdown(400), '0:01');
    assert.equal(formatCountdown(-5), '0:00');
  });
});
