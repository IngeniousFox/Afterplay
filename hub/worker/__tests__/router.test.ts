import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SYNC_ROUTES, formatDeviceToken } from '../../../src/shared/sync/protocol';
import type { DeviceTokenInfo } from '../../core/hub';
import { PUSH_BODY_MAX_BYTES, readLimitedText } from '../src/router';
import { HOST, VERSION, makeWorld, pairDevice, statusPath } from './helpers';

const json = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

describe('rutas de dispositivo (/sync/v1)', () => {
  it('sin token, con token mal formado o de un inquilino inexistente: 401 sin crear ningún DO', async () => {
    const world = makeWorld();
    await world.call('/api/v2/devices', { email: HOST }); // crea el inquilino del anfitrión
    const fake = formatDeviceToken('zzzzzz', 'a'.repeat(43));
    for (const token of [undefined, 'basura', 'ap1.x.y', fake]) {
      const response = await world.call(statusPath, { token });
      assert.equal(response.status, 401, String(token));
      assert.equal((await json(response)).error, 'unauthorized');
    }
    // Ni siquiera el DO del inquilino real se tocó: solo el del anfitrión, por la PWA.
    assert.equal(world.touched.includes('zzzzzz'), false);
    assert.equal(world.touched.length, 1);
  });

  it('un token con el inquilino bueno y el secreto malo lo rechaza el hub del inquilino', async () => {
    const world = makeWorld();
    const { tenantId } = await pairDevice(world);
    const response = await world.call(statusPath, {
      token: formatDeviceToken(tenantId, 'b'.repeat(43)),
    });
    assert.equal(response.status, 401);
  });

  it('flujo completo: código de la PWA -> enroll -> status, push vacío, pull', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    assert.ok(token.startsWith(`ap1.${tenantId}.`));

    const status = await world.call(statusPath, { token });
    assert.equal(status.status, 200);
    assert.equal(((await json(status)) as { seq: number }).seq, 0);

    const push = await world.call(SYNC_ROUTES.push, { token, body: { ...VERSION, rows: [] } });
    assert.equal(push.status, 200);
    assert.deepEqual((await json(push)).accepted, []);

    const pull = await world.call(
      `${SYNC_ROUTES.pull}?since=0&limit=10&protocolVersion=${VERSION.protocolVersion}&schemaVersion=${VERSION.schemaVersion}`,
      { token },
    );
    assert.equal(pull.status, 200);
    assert.equal((await json(pull)).more, false);
  });

  it('las versiones de las rutas GET son obligatorias y enteras: invalid_request', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    for (const path of [
      SYNC_ROUTES.status,
      `${SYNC_ROUTES.status}?protocolVersion=1`,
      `${SYNC_ROUTES.status}?protocolVersion=x&schemaVersion=1`,
      `${SYNC_ROUTES.pull}?protocolVersion=1&schemaVersion=1`,
      `${SYNC_ROUTES.pull}?since=-1&protocolVersion=1&schemaVersion=1`,
      `${SYNC_ROUTES.pull}?since=0&limit=1.5&protocolVersion=1&schemaVersion=1`,
    ]) {
      const response = await world.call(path, { token });
      assert.equal(response.status, 400, path);
      assert.equal((await json(response)).error, 'invalid_request');
    }
  });

  it('un cliente con protocolo de otra versión recibe 426 con el código del protocolo', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    const response = await world.call(
      `${SYNC_ROUTES.status}?protocolVersion=99&schemaVersion=${VERSION.schemaVersion}`,
      { token },
    );
    assert.equal(response.status, 426);
    assert.equal((await json(response)).error, 'protocol_mismatch');
  });

  it('rutas y métodos desconocidos', async () => {
    const world = makeWorld();
    const unknown = await world.call('/sync/v1/nope');
    assert.equal(unknown.status, 404);
    assert.equal((await json(unknown)).error, 'not_found');
    const wrongMethod = await world.call(SYNC_ROUTES.push, { method: 'GET' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'POST');
    assert.equal((await world.call('/')).status, 404);
  });

  it('push: por encima del tope de una fila sola es invalid_request ANTES de parsear, con y sin Content-Length', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    const big = JSON.stringify({
      ...VERSION,
      rows: [],
      pad: 'x'.repeat(PUSH_BODY_MAX_BYTES),
    });

    const declared = await world.call(SYNC_ROUTES.push, { token, rawBody: big });
    assert.equal(declared.status, 400);
    assert.equal((await json(declared)).error, 'invalid_request');

    // Cuerpo en flujo, sin Content-Length: se corta contando bytes.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
        for (let i = 0; i <= PUSH_BODY_MAX_BYTES / chunk.byteLength; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = await world.call(SYNC_ROUTES.push, {
      token,
      rawBody: stream,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(streamed.status, 400);
    assert.equal((await json(streamed)).error, 'invalid_request');
  });

  it('readLimitedText cuenta bytes UTF-8, no caracteres', async () => {
    const request = new Request('https://x.test', { method: 'POST', body: 'ñ'.repeat(10) });
    assert.equal((await readLimitedText(request, 20)).length, 10);
    await assert.rejects(
      readLimitedText(new Request('https://x.test', { method: 'POST', body: 'ñ'.repeat(10) }), 19),
    );
  });

  it('cuerpos que no son un objeto JSON: invalid_request', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    for (const rawBody of ['no es json', '[]', '"texto"', 'null']) {
      const response = await world.call(SYNC_ROUTES.push, { token, rawBody });
      assert.equal(response.status, 400, rawBody);
    }
  });

  it('concesiones: claim y done pasan por el hub del inquilino', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    const claim = await world.call(SYNC_ROUTES.jobsClaim, {
      token,
      body: { kind: 'memory', key: 'game-1', ttlSec: 600 },
    });
    assert.equal(claim.status, 200);
    const granted = (await json(claim)) as { granted: boolean; leaseId: string };
    assert.equal(granted.granted, true);
    const done = await world.call(SYNC_ROUTES.jobsDone, {
      token,
      body: { leaseId: granted.leaseId, outcome: 'ok' },
    });
    assert.deepEqual(await json(done), { closed: true });
  });

  it('un error inesperado sale como 500 sin mensaje ni stack; un cupo agotado, como 503', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    const service = world.services.get(tenantId)!;
    const original = console.error;
    console.error = () => undefined;
    try {
      service.status = () => Promise.reject(new Error('secreto interno C:\\ruta\\fichero.ts'));
      const failed = await world.call(statusPath, { token });
      assert.equal(failed.status, 500);
      const text = await failed.text();
      assert.equal(text.includes('secreto'), false);
      assert.equal(text.includes('fichero.ts'), false);
      assert.equal(JSON.parse(text).error, 'internal');

      service.status = () =>
        Promise.reject(new Error('Exceeded allowed rows written in Durable Objects free tier.'));
      const quota = await world.call(statusPath, { token });
      assert.equal(quota.status, 503);
      assert.equal((await json(quota)).error, 'quota_exceeded');
    } finally {
      console.error = original;
    }
  });
});

describe('emparejado (/sync/v1/enroll)', () => {
  const enrollBody = (code: unknown): Record<string, unknown> => ({
    ...VERSION,
    code,
    deviceId: 'pc-9',
    deviceName: 'PC',
  });

  it('un código sin la forma, de un inquilino que no existe o con el cuerpo del hub equivocado se ven iguales', async () => {
    const world = makeWorld();
    await world.call('/api/v2/devices', { email: HOST });
    const bodies: string[] = [];
    for (const code of ['', 'abc', 'zzzzzz-AAAAA-BBBBB', 42]) {
      const response = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(code) });
      assert.equal(response.status, 400);
      bodies.push(await response.text());
    }
    assert.equal(new Set(bodies).size, 1);
    assert.equal(JSON.parse(bodies[0]).error, 'enroll_code_invalid');
    assert.equal(world.touched.includes('zzzzzz'), false);
  });

  it('el código es de un solo uso y se acepta tecleado en minúsculas y con espacios', async () => {
    const world = makeWorld();
    const first = await pairDevice(world);
    const reused = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(first.code) });
    assert.equal(reused.status, 400);

    const response = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: HOST,
    });
    const { code } = (await json(response)) as { code: string };
    const typed = code.toLowerCase().replaceAll('-', ' ');
    const ok = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(typed) });
    assert.equal(ok.status, 200);
  });

  it('el código de un inquilino no canjea en otro', async () => {
    const world = makeWorld();
    await world.call('/api/v2/devices', { email: HOST });
    await world.call('/api/v2/invitations', { email: HOST, body: { email: 'ana@example.com' } });
    const anaResponse = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: 'ana@example.com',
    });
    const { code } = (await json(anaResponse)) as { code: string };
    const tenantOfHost = world.directoryStore.tenantOf(HOST)!.id;
    const tenantOfAna = world.directoryStore.tenantOf('ana@example.com')!.id;
    assert.notEqual(tenantOfHost, tenantOfAna);
    // Con el prefijo del anfitrión y el cuerpo del código de Ana.
    const forged = tenantOfHost + code.slice(6);
    const response = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(forged) });
    assert.equal(response.status, 400);
  });

  it('bloqueo por fuerza bruta: 5 fallos y el siguiente intento, aunque sea el código bueno, es 429', async () => {
    const world = makeWorld();
    const { tenantId } = await pairDevice(world);
    const codeResponse = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: HOST,
    });
    const { code: good } = (await json(codeResponse)) as { code: string };

    for (let i = 0; i < 5; i++) {
      const wrong = `${tenantId}-AAAAA-0000${i}`;
      const response = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(wrong) });
      assert.equal(response.status, 400);
    }
    const locked = await world.call(SYNC_ROUTES.enroll, { body: enrollBody(good) });
    assert.equal(locked.status, 429);
    assert.equal((await json(locked)).error, 'rate_limited');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    // Pasado el bloqueo, el código bueno (si no ha caducado) vuelve a valer.
    world.time.now += 9 * 60_000;
    assert.equal((await world.call(SYNC_ROUTES.enroll, { body: enrollBody(good) })).status, 429);
    world.time.now += 7 * 60_000;
    // 16 min después el código (TTL 10 min) ya caducó: 400, pero ya no 429.
    assert.equal((await world.call(SYNC_ROUTES.enroll, { body: enrollBody(good) })).status, 400);
  });
});

describe('rutas de la PWA (/api/v2)', () => {
  it('sin sesión de Access: 401', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/devices');
    assert.equal(response.status, 401);
  });

  it('fallo cerrado: un correo desconocido recibe 403 y no se crea nada', async () => {
    const world = makeWorld();
    for (const path of ['/api/v2/devices', '/api/v2/devices/enroll-code']) {
      const response = await world.call(path, {
        email: 'intruso@example.com',
        method: path.endsWith('code') ? 'POST' : 'GET',
      });
      assert.equal(response.status, 403, path);
    }
    assert.equal(world.touched.length, 0);
  });

  it('sin ADMIN_EMAIL ni el anfitrión entra', async () => {
    const world = makeWorld(null);
    assert.equal((await world.call('/api/v2/devices', { email: HOST })).status, 403);
  });

  it('/me: dice quién eres y si eres el anfitrión (sin distinguir mayúsculas)', async () => {
    const world = makeWorld();
    const host = await world.call('/api/v2/me', { email: HOST.toUpperCase() });
    assert.equal(host.status, 200);
    assert.deepEqual(await json(host), { email: HOST, isHost: true });

    await world.call('/api/v2/invitations', { email: HOST, body: { email: 'ana@example.com' } });
    const ana = await world.call('/api/v2/me', { email: 'ana@example.com' });
    assert.deepEqual(await json(ana), { email: 'ana@example.com', isHost: false });
  });

  it('/me: sin sesión 401, desconocido 403, otro método 405; sin ADMIN_EMAIL nadie es anfitrión', async () => {
    const world = makeWorld();
    assert.equal((await world.call('/api/v2/me')).status, 401);
    assert.equal((await world.call('/api/v2/me', { email: 'intruso@example.com' })).status, 403);
    const post = await world.call('/api/v2/me', { email: HOST, method: 'POST' });
    assert.equal(post.status, 405);

    const noHost = makeWorld(null);
    assert.equal((await noHost.call('/api/v2/me', { email: HOST })).status, 403);
  });

  it('la primera entrada del anfitrión crea su inquilino; el código lleva su id', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: HOST,
    });
    assert.equal(response.status, 200);
    const { code, expiresAt } = (await json(response)) as { code: string; expiresAt: number };
    const tenantId = world.directoryStore.tenantOf(HOST)!.id;
    assert.match(code, new RegExp(`^${tenantId}-[0-9A-Z]{5}-[0-9A-Z]{5}$`));
    assert.equal(expiresAt, world.time.now + 10 * 60_000);
  });

  it('lista y revoca dispositivos; el token revocado deja de valer', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    const list = (await (
      await world.call('/api/v2/devices', { email: HOST })
    ).json()) as DeviceTokenInfo[];
    assert.equal(list.length, 1);
    assert.equal(list[0].deviceName, 'Sobremesa');
    assert.equal('tokenHash' in list[0], false);

    const revoke = await world.call(`/api/v2/devices/${list[0].tokenId}/revoke`, {
      method: 'POST',
      email: HOST,
    });
    assert.equal(revoke.status, 200);
    assert.equal((await world.call(statusPath, { token })).status, 401);
    // Revocar otra vez, o uno inexistente: 404.
    const again = await world.call(`/api/v2/devices/${list[0].tokenId}/revoke`, {
      method: 'POST',
      email: HOST,
    });
    assert.equal(again.status, 404);
    const odd = await world.call('/api/v2/devices/..%2Fx/revoke', { method: 'POST', email: HOST });
    assert.equal(odd.status, 404);
  });

  it('un inquilino no ve ni revoca los dispositivos de otro', async () => {
    const world = makeWorld();
    await pairDevice(world);
    await world.call('/api/v2/invitations', { email: HOST, body: { email: 'ana@example.com' } });
    const anaList = (await (
      await world.call('/api/v2/devices', { email: 'ana@example.com' })
    ).json()) as DeviceTokenInfo[];
    assert.deepEqual(anaList, []);
    const hostList = (await (
      await world.call('/api/v2/devices', { email: HOST })
    ).json()) as DeviceTokenInfo[];
    const revoke = await world.call(`/api/v2/devices/${hostList[0].tokenId}/revoke`, {
      method: 'POST',
      email: 'ana@example.com',
    });
    assert.equal(revoke.status, 404);
    assert.equal(
      (
        (await (await world.call('/api/v2/devices', { email: HOST })).json()) as DeviceTokenInfo[]
      )[0].revokedAt,
      null,
    );
  });

  it('invitaciones: solo el anfitrión; el invitado entra y obtiene su propio inquilino (D-03)', async () => {
    const world = makeWorld();
    await world.call('/api/v2/devices', { email: HOST });

    const byAna = await world.call('/api/v2/invitations', {
      email: 'ana@example.com',
      body: { email: 'otra@example.com' },
    });
    assert.equal(byAna.status, 403);

    assert.equal((await world.call('/api/v2/devices', { email: 'ana@example.com' })).status, 403);
    const invite = await world.call('/api/v2/invitations', {
      email: HOST,
      body: { email: 'Ana@Example.com' },
    });
    assert.equal(invite.status, 201);
    assert.equal((await world.call('/api/v2/devices', { email: 'ana@example.com' })).status, 200);
    assert.notEqual(
      world.directoryStore.tenantOf('ana@example.com')!.id,
      world.directoryStore.tenantOf(HOST)!.id,
    );

    const duplicate = await world.call('/api/v2/invitations', {
      email: HOST,
      body: { email: 'ana@example.com' },
    });
    assert.equal(duplicate.status, 409);
    const bad = await world.call('/api/v2/invitations', { email: HOST, body: { email: 'nope' } });
    assert.equal(bad.status, 400);
    const missing = await world.call('/api/v2/invitations', { email: HOST, body: {} });
    assert.equal(missing.status, 400);
  });

  it('subir la época (restauración): solo el anfitrión, un inquilino o todos', async () => {
    const world = makeWorld();
    const host = await pairDevice(world);
    await world.call('/api/v2/invitations', { email: HOST, body: { email: 'ana@example.com' } });
    await world.call('/api/v2/devices', { email: 'ana@example.com' });
    const anaTenant = world.directoryStore.tenantOf('ana@example.com')!.id;
    const epochOf = async (token: string): Promise<number> =>
      ((await (await world.call(statusPath, { token })).json()) as { epoch: number }).epoch;
    const before = await epochOf(host.token);

    const call = (email: string | undefined, body: unknown): Promise<Response> =>
      world.call('/api/v2/admin/epoch', { email, body });
    assert.equal((await call(undefined, { all: true })).status, 401);
    assert.equal((await call('ana@example.com', { all: true })).status, 403);
    assert.equal((await world.call('/api/v2/admin/epoch', { email: HOST })).status, 405);
    assert.equal((await call(HOST, {})).status, 400);
    assert.equal((await call(HOST, { tenantId: 'zzzzzz' })).status, 404);
    assert.equal(await epochOf(host.token), before, 'nada cambió con las peticiones rechazadas');

    const one = await call(HOST, { tenantId: host.tenantId });
    assert.equal(one.status, 200);
    assert.deepEqual(await one.json(), { epochs: { [host.tenantId]: before + 1 } });
    assert.equal(await epochOf(host.token), before + 1);

    const all = (await (await call(HOST, { all: true })).json()) as {
      epochs: Record<string, number>;
    };
    assert.deepEqual(Object.keys(all.epochs).sort(), [host.tenantId, anaTenant].sort());
    assert.equal(all.epochs[host.tenantId], before + 2);
    assert.equal(await epochOf(host.token), before + 2);
  });

  it('las peticiones que cambian algo y vienen de otro origen se rechazan', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: HOST,
      headers: { Origin: 'https://malo.example' },
    });
    assert.equal(response.status, 403);
    const same = await world.call('/api/v2/devices/enroll-code', {
      method: 'POST',
      email: HOST,
      headers: { Origin: 'https://hub.test' },
    });
    assert.equal(same.status, 200);
  });

  it('rutas desconocidas y métodos equivocados', async () => {
    const world = makeWorld();
    assert.equal((await world.call('/api/v2/otra-cosa', { email: HOST })).status, 404);
    assert.equal((await world.call('/api/v2/devices/enroll-code', { email: HOST })).status, 405);
  });
});

describe('secreto de alta (/sync/v1/enroll-secret)', () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const enrollWith = (enrollSecret: unknown, deviceId = 'pc-9'): Record<string, unknown> => ({
    ...VERSION,
    enrollSecret,
    deviceId,
    deviceName: 'PC',
  });
  const issue = async (
    world: ReturnType<typeof makeWorld>,
    token: string,
  ): Promise<{ enrollSecret: string; expiresAt: number }> => {
    const response = await world.call(SYNC_ROUTES.enrollSecret, { method: 'POST', token });
    assert.equal(response.status, 200);
    return (await json(response)) as { enrollSecret: string; expiresAt: number };
  };

  it('emitir exige un token válido: sin él, mal formado, falso o revocado, 401', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    const forged = formatDeviceToken(tenantId, 'c'.repeat(43));
    for (const bad of [undefined, 'basura', forged]) {
      const response = await world.call(SYNC_ROUTES.enrollSecret, { method: 'POST', token: bad });
      assert.equal(response.status, 401, String(bad));
    }
    // La PWA (Access) no es la puerta de esta ruta.
    const viaAccess = await world.call(SYNC_ROUTES.enrollSecret, { method: 'POST', email: HOST });
    assert.equal(viaAccess.status, 401);
    assert.equal((await world.call(SYNC_ROUTES.enrollSecret, { token })).status, 405);
    // Revocado: deja de poder emitir.
    const devices = (await (await world.call('/api/v2/devices', { email: HOST })).json()) as {
      tokenId: string;
    }[];
    await world.call(`/api/v2/devices/${devices[0].tokenId}/revoke`, {
      method: 'POST',
      email: HOST,
    });
    const revoked = await world.call(SYNC_ROUTES.enrollSecret, { method: 'POST', token });
    assert.equal(revoked.status, 401);
  });

  it('el secreto lleva el inquilino delante, caduca a los 7 días y canjea en varios PCs', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    const { enrollSecret, expiresAt } = await issue(world, token);
    assert.match(enrollSecret, new RegExp(`^aes1\\.${tenantId}\\.[0-9a-zA-Z_-]{43}$`));
    assert.equal(expiresAt, world.time.now + WEEK);

    const tokens = new Set<string>([token]);
    for (const deviceId of ['pc-a', 'pc-b', 'pc-c']) {
      const response = await world.call(SYNC_ROUTES.enroll, {
        body: enrollWith(enrollSecret, deviceId),
      });
      assert.equal(response.status, 200);
      const enrolled = await json(response);
      assert.equal(enrolled.tenantId, tenantId);
      tokens.add(String(enrolled.token));
      const status = await world.call(statusPath, { token: String(enrolled.token) });
      assert.equal(status.status, 200);
    }
    assert.equal(tokens.size, 4, 'cada alta crea un token nuevo');
  });

  it('caducado, o sustituido por uno nuevo, falla como un código desconocido', async () => {
    const world = makeWorld();
    const { token } = await pairDevice(world);
    const old = await issue(world, token);
    const fresh = await issue(world, token);
    assert.notEqual(old.enrollSecret, fresh.enrollSecret);

    const replaced = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(old.enrollSecret) });
    assert.equal(replaced.status, 400);
    assert.equal((await json(replaced)).error, 'enroll_code_invalid');
    assert.equal(
      (await world.call(SYNC_ROUTES.enroll, { body: enrollWith(fresh.enrollSecret) })).status,
      200,
    );

    world.time.now += WEEK;
    const expired = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(fresh.enrollSecret) });
    assert.equal(expired.status, 400);
    assert.equal((await json(expired)).error, 'enroll_code_invalid');
  });

  it('basura, otro inquilino, inquilino inexistente y secreto equivocado se ven iguales', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    await world.call('/api/v2/invitations', { email: HOST, body: { email: 'ana@example.com' } });
    await world.call('/api/v2/devices', { email: 'ana@example.com' });
    const tenantOfAna = world.directoryStore.tenantOf('ana@example.com')!.id;
    const { enrollSecret } = await issue(world, token);
    const body43 = enrollSecret.split('.')[2];
    const candidates: unknown[] = [
      '',
      42,
      'abc',
      `aes1.${tenantId}.corto`,
      `aes1.zzzzzz.${body43}`,
      `aes1.${tenantOfAna}.${body43}`,
      `aes1.${tenantId}.${'a'.repeat(43)}`,
      `ap1.${tenantId}.${body43}`,
    ];
    const bodies = new Set<string>();
    for (const candidate of candidates) {
      const response = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(candidate) });
      assert.equal(response.status, 400, String(candidate));
      bodies.add(await response.text());
    }
    assert.equal(bodies.size, 1);
    assert.equal(JSON.parse([...bodies][0]).error, 'enroll_code_invalid');
    assert.equal(world.touched.includes('zzzzzz'), false);
    // Código y secreto a la vez: tampoco canjea.
    const both = await world.call(SYNC_ROUTES.enroll, {
      body: { ...enrollWith(enrollSecret), code: 'x' },
    });
    assert.equal(both.status, 400);
    assert.equal((await json(both)).error, 'enroll_code_invalid');
  });

  it('bloqueo por fuerza bruta: 5 fallos y el siguiente, aunque sea el secreto bueno, es 429', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    const { enrollSecret } = await issue(world, token);
    for (let i = 0; i < 5; i++) {
      const wrong = `aes1.${tenantId}.${String(i).repeat(43)}`;
      const response = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(wrong) });
      assert.equal(response.status, 400);
    }
    const locked = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(enrollSecret) });
    assert.equal(locked.status, 429);
    assert.equal((await json(locked)).error, 'rate_limited');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    // Pasado el bloqueo, el secreto bueno vuelve a valer.
    world.time.now += 16 * 60_000;
    assert.equal(
      (await world.call(SYNC_ROUTES.enroll, { body: enrollWith(enrollSecret) })).status,
      200,
    );
  });

  it('ni las respuestas de error ni el log contienen el secreto', async () => {
    const world = makeWorld();
    const { token, tenantId } = await pairDevice(world);
    const { enrollSecret } = await issue(world, token);
    const raw = enrollSecret.split('.')[2];
    const wrong = `aes1.${tenantId}.${raw.split('').reverse().join('')}`;
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => seen.push(args.map(String).join(' '));
    try {
      const failed = await world.call(SYNC_ROUTES.enroll, { body: enrollWith(wrong) });
      seen.push(await failed.text());
      const malformed = await world.call(SYNC_ROUTES.enroll, {
        rawBody: `{"enrollSecret":"${raw}`,
      });
      seen.push(await malformed.text());
    } finally {
      console.error = original;
    }
    for (const text of seen) assert.ok(!text.includes(raw) && !text.includes(wrong));
  });
});
