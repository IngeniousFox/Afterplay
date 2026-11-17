import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SyncRequestError } from '../../../shared/sync/protocol';
import {
  createHttpTransport,
  enroll,
  exchangeCredentials,
  requestEnrollSecret,
} from '../httpTransport';

// El transporte HTTP con un `fetch` falso: ni red ni credenciales reales.

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as string | undefined,
    };
    seen.push(entry);
    return respond(entry);
  }) as typeof fetch;
  return { fetch: impl, seen };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const VERSION = { protocolVersion: 1, schemaVersion: 3 };
const TOKEN = 'ap1.tenant1.0123456789abcdef0123';

describe('transporte HTTP', () => {
  it('status y pull: GET con el token y la versión en la URL', async () => {
    const { fetch, seen } = fakeFetch(() => json({ ok: true }));
    const transport = createHttpTransport({
      baseUrl: 'https://hub.example.test/',
      token: TOKEN,
      fetch,
    });

    await transport.status(VERSION);
    await transport.pull(42, 1000, VERSION);

    assert.equal(
      seen[0].url,
      'https://hub.example.test/sync/v1/status?protocolVersion=1&schemaVersion=3',
    );
    assert.equal(
      seen[1].url,
      'https://hub.example.test/sync/v1/pull?since=42&limit=1000&protocolVersion=1&schemaVersion=3',
    );
    for (const entry of seen) {
      assert.equal(entry.method, 'GET');
      assert.equal(entry.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(entry.body, undefined);
    }
  });

  it('push: POST con el cuerpo en JSON', async () => {
    const { fetch, seen } = fakeFetch(() => json({ accepted: [] }));
    const transport = createHttpTransport({
      baseUrl: 'https://hub.example.test',
      token: TOKEN,
      fetch,
    });

    await transport.push({ ...VERSION, rows: [] });

    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, 'https://hub.example.test/sync/v1/push');
    assert.equal(seen[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(seen[0].body ?? ''), { ...VERSION, rows: [] });
  });

  it('conserva una ruta base del hub', async () => {
    const { fetch, seen } = fakeFetch(() => json({}));
    const transport = createHttpTransport({
      baseUrl: 'https://example.test/hub/',
      token: TOKEN,
      fetch,
    });
    await transport.status(VERSION);
    assert.ok(seen[0].url.startsWith('https://example.test/hub/sync/v1/status?'));
  });

  it('un cuerpo de error del protocolo se convierte en SyncRequestError con su código', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'schema_too_old', message: 'actualiza', minSchema: 4 }, 426),
    );
    const transport = createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch });

    await assert.rejects(transport.status(VERSION), (error: unknown) => {
      assert.ok(error instanceof SyncRequestError);
      assert.equal(error.code, 'schema_too_old');
      assert.equal(error.status, 426);
      assert.equal(error.body?.minSchema, 4);
      assert.equal(error.message, 'actualiza');
      return true;
    });
  });

  it('un 401 con cuerpo es unauthorized; un 5xx sin cuerpo del protocolo es network', async () => {
    const unauthorized = fakeFetch(() => json({ error: 'unauthorized', message: 'revocado' }, 401));
    await assert.rejects(
      createHttpTransport({
        baseUrl: 'https://h.test',
        token: TOKEN,
        fetch: unauthorized.fetch,
      }).status(VERSION),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'unauthorized',
    );

    const html = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await assert.rejects(
      createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch: html.fetch }).status(
        VERSION,
      ),
      (error: unknown) =>
        error instanceof SyncRequestError && error.code === 'network' && error.status === 502,
    );

    const quota = fakeFetch(() => json({ error: 'quota_exceeded', message: 'cupo' }, 503));
    await assert.rejects(
      createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch: quota.fetch }).push({
        ...VERSION,
        rows: [],
      }),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'quota_exceeded',
    );
  });

  it('un código de error desconocido no se hace pasar por uno del protocolo', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'otra_cosa', message: 'x' }, 400));
    await assert.rejects(
      createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch }).status(VERSION),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'network',
    );
  });

  it('un fallo de red o una respuesta que no es JSON es network', async () => {
    const down = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await assert.rejects(
      createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch: down.fetch }).status(
        VERSION,
      ),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'network',
    );

    const text = fakeFetch(() => new Response('hola', { status: 200 }));
    await assert.rejects(
      createHttpTransport({ baseUrl: 'https://h.test', token: TOKEN, fetch: text.fetch }).status(
        VERSION,
      ),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'network',
    );
  });

  it('corta una petición que no responde a tiempo', async () => {
    const hang = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const transport = createHttpTransport({
      baseUrl: 'https://h.test',
      token: TOKEN,
      timeoutMs: 20,
      fetch: hang,
    });
    await assert.rejects(
      transport.status(VERSION),
      (error: unknown) =>
        error instanceof SyncRequestError &&
        error.code === 'network' &&
        /no respondió/.test(error.message),
    );
  });

  it('enroll no lleva token y devuelve la respuesta', async () => {
    const reply = {
      hubId: 'hub-1',
      epoch: 1,
      token: TOKEN,
      tenantId: 'tenant1',
      shortDeviceId: 'abc123',
      serverTime: 1,
    };
    const { fetch, seen } = fakeFetch(() => json(reply));

    const response = await enroll(
      'https://hub.example.test',
      { ...VERSION, code: 'CODIGO', deviceId: 'dev-1', deviceName: 'PC' },
      { fetch },
    );

    assert.deepEqual(response, reply);
    assert.equal(seen[0].url, 'https://hub.example.test/sync/v1/enroll');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].headers.Authorization, undefined);
  });

  it('enroll con un código inválido lanza enroll_code_invalid', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'enroll_code_invalid', message: 'código caducado' }, 400),
    );
    await assert.rejects(
      enroll(
        'https://h.test',
        { ...VERSION, code: 'x', deviceId: 'd', deviceName: 'PC' },
        { fetch },
      ),
      (error: unknown) => error instanceof SyncRequestError && error.code === 'enroll_code_invalid',
    );
  });
});

describe('secreto de alta', () => {
  const secret = `aes1.tenant1.${'z'.repeat(43)}`;

  it('POST con el token del dispositivo y devuelve secreto y caducidad', async () => {
    const { fetch, seen } = fakeFetch(() => json({ enrollSecret: secret, expiresAt: 9 }));

    const response = await requestEnrollSecret({
      baseUrl: 'https://hub.example.test/',
      token: TOKEN,
      fetch,
    });

    assert.deepEqual(response, { enrollSecret: secret, expiresAt: 9 });
    assert.equal(seen[0].url, 'https://hub.example.test/sync/v1/enroll-secret');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`);
  });

  it('enroll con secreto va sin token y un fallo no repite el secreto', async () => {
    const { fetch, seen } = fakeFetch(() =>
      json({ error: 'enroll_code_invalid', message: 'código de emparejado desconocido' }, 400),
    );
    await assert.rejects(
      enroll(
        'https://h.test',
        { ...VERSION, enrollSecret: secret, deviceId: 'd', deviceName: 'PC' },
        { fetch },
      ),
      (error: unknown) =>
        error instanceof SyncRequestError &&
        error.code === 'enroll_code_invalid' &&
        !JSON.stringify(error).includes('zzzz') &&
        !error.message.includes('zzzz'),
    );
    assert.equal(seen[0].headers.Authorization, undefined);
    assert.equal(JSON.parse(seen[0].body ?? '').enrollSecret, secret);
  });
});

describe('intercambio de credenciales', () => {
  const entries = { steamApiKey: { value: 'clave-de-prueba', updatedAt: 10 } };

  it('POST con el token del dispositivo y el paquete en el cuerpo', async () => {
    const { fetch, seen } = fakeFetch(() => json({ entries }));

    const response = await exchangeCredentials(
      { baseUrl: 'https://hub.example.test/', token: TOKEN, fetch },
      { entries },
    );

    assert.deepEqual(response, { entries });
    assert.equal(seen[0].url, 'https://hub.example.test/sync/v1/credentials');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(seen[0].body ?? ''), { entries });
  });

  it('un error del hub conserva su código y no repite las claves en el mensaje', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'internal', message: 'el hub no tiene configurado HUB_SECRETS_KEY' }, 500),
    );
    await assert.rejects(
      exchangeCredentials({ baseUrl: 'https://h.test', token: TOKEN, fetch }, { entries }),
      (error: unknown) =>
        error instanceof SyncRequestError &&
        error.code === 'internal' &&
        !error.message.includes('clave-de-prueba'),
    );
  });
});
