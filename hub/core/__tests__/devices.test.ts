import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeviceShortId, isReservedDeviceShortId } from '../../../src/shared/sync/clock';
import {
  parseDeviceToken,
  type EnrollRequest,
  type EnrollResponse,
} from '../../../src/shared/sync/protocol';
import { HubError, LAST_USED_WRITE_INTERVAL_MS, normalizeEnrollmentCode } from '../hub';
import { T0, VERSION, makeHub, type TestHub } from './helpers';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HubError, `no es un HubError: ${String(error)}`);
    return error.code;
  }
  return 'no lanzó';
}

const request = (code: string, deviceId = 'pc-1', deviceName = 'Sobremesa'): EnrollRequest => ({
  ...VERSION,
  code,
  deviceId,
  deviceName,
});

async function enrolled(test: TestHub, deviceId = 'pc-1'): Promise<EnrollResponse> {
  const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
  const res = await test.hub.enroll(request(code, deviceId));
  return res;
}

describe('códigos de emparejado', () => {
  it('canjea un código por un token con la forma ap1.<inquilino>.<secreto>', async () => {
    const test = makeHub();
    const { code, expiresAt } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(expiresAt, T0 + 10 * 60_000);

    const res = await test.hub.enroll(request(code));
    const parsed = parseDeviceToken(res.token);
    assert.ok(parsed);
    assert.equal(parsed.tenantId, 'tenant1');
    assert.equal(res.tenantId, 'tenant1');
    assert.equal(res.hubId, test.hub.status(VERSION).hubId);
    assert.equal(res.epoch, 1);
    assert.ok(isDeviceShortId(res.shortDeviceId));
    assert.ok(!isReservedDeviceShortId(res.shortDeviceId));
  });

  it('es de un solo uso', async () => {
    const test = makeHub();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    await test.hub.enroll(request(code, 'pc-1'));
    assert.equal(await codeOf(test.hub.enroll(request(code, 'pc-2'))), 'enroll_code_invalid');
    // Y no queda rastro del código en la base.
    assert.equal(test.storage.exec('SELECT COUNT(*) AS c FROM enrollment_codes')[0].c, 0);
  });

  it('caduca: el borde exacto ya no vale', async () => {
    const test = makeHub();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 5 });
    test.time.now = T0 + 5 * 60_000 - 1;
    const ok = await test.hub.createEnrollmentCode({ ttlMinutes: 5 });
    test.time.now = T0 + 5 * 60_000;
    assert.equal(await codeOf(test.hub.enroll(request(code))), 'enroll_code_invalid');
    // El código nuevo (creado en T0 + 5 min - 1 ms... en tiempo del test) sigue vivo.
    assert.ok((await test.hub.enroll(request(ok.code))).token);
  });

  it('rechaza un código desconocido y acepta variantes de tecleo', async () => {
    const test = makeHub();
    assert.equal(await codeOf(test.hub.enroll(request('AAAAA-AAAAA'))), 'enroll_code_invalid');
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    const sloppy = ` ${code.toLowerCase().replace('-', ' ')} `;
    assert.equal(normalizeEnrollmentCode('ab-oIl'), 'AB011');
    assert.ok((await test.hub.enroll(request(sloppy))).token);
  });

  it('un código de varios usos sirve hasta agotarse', async () => {
    const test = makeHub();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 60, maxUses: 2 });
    await test.hub.enroll(request(code, 'pc-1'));
    await test.hub.enroll(request(code, 'pc-2'));
    assert.equal(await codeOf(test.hub.enroll(request(code, 'pc-3'))), 'enroll_code_invalid');
  });

  it('guarda solo huellas: ni el código ni el secreto están en la base', async () => {
    const test = makeHub();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    const stored = JSON.stringify(test.storage.exec('SELECT * FROM enrollment_codes'));
    assert.ok(!stored.includes(code.replace('-', '')));
    const res = await test.hub.enroll(request(code));
    const secret = parseDeviceToken(res.token)!.secret;
    const dump = JSON.stringify(test.storage.exec('SELECT * FROM device_tokens'));
    assert.ok(!dump.includes(secret));
    assert.match(
      String(test.storage.exec('SELECT tokenHash FROM device_tokens')[0].tokenHash),
      /^[0-9a-f]{64}$/,
    );
  });

  it('valida la petición y las versiones', async () => {
    const test = makeHub();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    assert.equal(
      await codeOf(test.hub.enroll({ ...request(code), deviceId: '' })),
      'invalid_request',
    );
    assert.equal(
      await codeOf(test.hub.enroll({ ...request(code), code: 5 as never })),
      'invalid_request',
    );
    assert.equal(
      await codeOf(test.hub.enroll({ ...request(code), protocolVersion: 99 })),
      'protocol_mismatch',
    );
    // Ninguno de los intentos fallidos gastó el código.
    assert.ok((await test.hub.enroll(request(code))).token);
    await assert.rejects(test.hub.createEnrollmentCode({ ttlMinutes: 0 }), RangeError);
  });
});

describe('ids cortos', () => {
  it('son únicos por dispositivo, de 6 caracteres y nunca reservados', async () => {
    const test = makeHub();
    const seen = new Set<string>();
    for (let n = 0; n < 300; n++) {
      const { shortDeviceId } = await enrolled(test, `pc-${n}`);
      assert.ok(isDeviceShortId(shortDeviceId));
      assert.ok(!isReservedDeviceShortId(shortDeviceId));
      assert.ok(!seen.has(shortDeviceId), `repetido: ${shortDeviceId}`);
      seen.add(shortDeviceId);
    }
    assert.equal(seen.size, 300);
  });

  it('un dispositivo que se vuelve a emparejar conserva su id corto y revoca el token viejo', async () => {
    const test = makeHub();
    const first = await enrolled(test, 'pc-1');
    const second = await enrolled(test, 'pc-1');
    assert.equal(second.shortDeviceId, first.shortDeviceId);
    assert.notEqual(second.token, first.token);
    const oldToken = parseDeviceToken(first.token)!;
    assert.equal(await codeOf(test.hub.authenticate(oldToken.secret)), 'unauthorized');
    const device = await test.hub.authenticate(parseDeviceToken(second.token)!.secret);
    assert.equal(device.deviceId, 'pc-1');
    assert.equal(test.hub.listTokens().filter((t) => t.revokedAt === null).length, 1);
  });
});

describe('autenticación de tokens', () => {
  it('reconoce al dispositivo por su secreto', async () => {
    const test = makeHub();
    const res = await enrolled(test, 'pc-7');
    const device = await test.hub.authenticateToken(res.token);
    assert.equal(device.deviceId, 'pc-7');
    assert.equal(device.deviceName, 'Sobremesa');
    assert.equal(device.shortDeviceId, res.shortDeviceId);
  });

  it('rechaza tokens mal formados, de otro inquilino y desconocidos', async () => {
    const test = makeHub();
    const res = await enrolled(test);
    const { secret } = parseDeviceToken(res.token)!;
    assert.equal(await codeOf(test.hub.authenticateToken('basura')), 'unauthorized');
    assert.equal(await codeOf(test.hub.authenticateToken(`ap1.otro.${secret}`)), 'unauthorized');
    assert.equal(await codeOf(test.hub.authenticate('x'.repeat(43))), 'unauthorized');
    assert.equal(await codeOf(test.hub.authenticate('corto')), 'unauthorized');
    assert.equal(await codeOf(test.hub.authenticate(undefined as never)), 'unauthorized');
  });

  it('un token revocado deja de valer y se ve en la lista', async () => {
    const test = makeHub();
    const res = await enrolled(test, 'pc-1');
    test.time.now += 1000;
    await enrolled(test, 'pc-2');
    const device = await test.hub.authenticateToken(res.token);
    assert.equal(test.hub.revokeToken(device.tokenId), true);
    assert.equal(test.hub.revokeToken(device.tokenId), false);
    assert.equal(test.hub.revokeToken('no-existe'), false);
    assert.equal(await codeOf(test.hub.authenticateToken(res.token)), 'unauthorized');

    const list = test.hub.listTokens();
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((t) => [t.deviceId, t.revokedAt !== null]),
      [
        ['pc-1', true],
        ['pc-2', false],
      ],
    );
    // La lista no revela secretos ni huellas.
    assert.ok(!JSON.stringify(list).includes('tokenHash'));
  });

  it('escribe el último uso como mucho una vez por hora', async () => {
    const test = makeHub();
    const res = await enrolled(test);
    const lastUsed = (): number | null =>
      (test.hub.listTokens()[0].lastUsedAt as number | null) ?? null;
    assert.equal(lastUsed(), null);

    await test.hub.authenticateToken(res.token);
    assert.equal(lastUsed(), T0);
    test.time.now = T0 + LAST_USED_WRITE_INTERVAL_MS - 1;
    await test.hub.authenticateToken(res.token);
    assert.equal(lastUsed(), T0, 'dentro de la hora no se reescribe');
    test.time.now = T0 + LAST_USED_WRITE_INTERVAL_MS;
    await test.hub.authenticateToken(res.token);
    assert.equal(lastUsed(), T0 + LAST_USED_WRITE_INTERVAL_MS);
  });
});

describe('secreto de alta (§9.3, §19.3.1)', () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const withSecret = (secret: string, deviceId = 'pc-1'): EnrollRequest => ({
    ...VERSION,
    enrollSecret: secret,
    deviceId,
    deviceName: 'Sobremesa',
  });

  it('se emite con 258 bits, caduca a los 7 días y el hub solo guarda su huella', async () => {
    const test = makeHub();
    const { secret, expiresAt } = await test.hub.createEnrollmentSecret();
    assert.match(secret, /^[0-9a-zA-Z_-]{43}$/);
    assert.equal(expiresAt, T0 + WEEK);
    const stored = JSON.stringify(test.storage.exec('SELECT * FROM enrollment_secret'));
    assert.ok(!stored.includes(secret));
    assert.match(
      String(test.storage.exec('SELECT secretHash FROM enrollment_secret')[0].secretHash),
      /^[0-9a-f]{64}$/,
    );
  });

  it('vale para varios PCs y cada uno recibe su propio token', async () => {
    const test = makeHub();
    const { secret } = await test.hub.createEnrollmentSecret();
    const a = await test.hub.enroll(withSecret(secret, 'pc-1'));
    const b = await test.hub.enroll(withSecret(secret, 'pc-2'));
    const c = await test.hub.enroll(withSecret(secret, 'pc-3'));
    assert.equal(new Set([a.token, b.token, c.token]).size, 3);
    assert.equal(new Set([a.shortDeviceId, b.shortDeviceId, c.shortDeviceId]).size, 3);
    for (const res of [a, b, c]) {
      assert.equal((await test.hub.authenticateToken(res.token)).deviceId.startsWith('pc-'), true);
    }
    // El secreto no se gasta con los usos.
    assert.equal(test.storage.exec('SELECT COUNT(*) AS c FROM enrollment_secret')[0].c, 1);
  });

  it('un PC que se empareja otra vez con el secreto revoca su token anterior', async () => {
    const test = makeHub();
    const { secret } = await test.hub.createEnrollmentSecret();
    const first = await test.hub.enroll(withSecret(secret, 'pc-1'));
    const second = await test.hub.enroll(withSecret(secret, 'pc-1'));
    assert.equal(await codeOf(test.hub.authenticateToken(first.token)), 'unauthorized');
    assert.ok(await test.hub.authenticateToken(second.token));
  });

  it('caducado falla igual que uno desconocido, y el barrido lo borra', async () => {
    const test = makeHub();
    const { secret } = await test.hub.createEnrollmentSecret();
    test.time.now = T0 + WEEK - 1;
    assert.ok((await test.hub.enroll(withSecret(secret))).token);
    test.time.now = T0 + WEEK;
    assert.equal(await codeOf(test.hub.enroll(withSecret(secret, 'pc-2'))), 'enroll_code_invalid');
    assert.equal(test.hub.sweep().deletedEnrollmentCodes, 1);
    assert.equal(test.storage.exec('SELECT COUNT(*) AS c FROM enrollment_secret')[0].c, 0);
  });

  it('emitir otro sustituye al anterior: el viejo deja de valer', async () => {
    const test = makeHub();
    const old = await test.hub.createEnrollmentSecret();
    test.time.now += 1000;
    const fresh = await test.hub.createEnrollmentSecret();
    assert.notEqual(old.secret, fresh.secret);
    assert.equal(fresh.expiresAt, T0 + 1000 + WEEK);
    assert.equal(test.storage.exec('SELECT COUNT(*) AS c FROM enrollment_secret')[0].c, 1);
    assert.equal(await codeOf(test.hub.enroll(withSecret(old.secret))), 'enroll_code_invalid');
    assert.ok((await test.hub.enroll(withSecret(fresh.secret))).token);
  });

  it('un secreto desconocido o sin emitir ninguno falla con el mismo código', async () => {
    const test = makeHub();
    assert.equal(await codeOf(test.hub.enroll(withSecret('a'.repeat(43)))), 'enroll_code_invalid');
    await test.hub.createEnrollmentSecret();
    assert.equal(await codeOf(test.hub.enroll(withSecret('a'.repeat(43)))), 'enroll_code_invalid');
  });

  it('el secreto no canjea como código ni al revés; mandar los dos o ninguno es invalid_request', async () => {
    const test = makeHub();
    const { secret } = await test.hub.createEnrollmentSecret();
    const { code } = await test.hub.createEnrollmentCode({ ttlMinutes: 10 });
    assert.equal(await codeOf(test.hub.enroll(request(secret))), 'enroll_code_invalid');
    assert.equal(await codeOf(test.hub.enroll(withSecret(code))), 'enroll_code_invalid');
    assert.equal(
      await codeOf(test.hub.enroll({ ...withSecret(secret), code } as EnrollRequest)),
      'invalid_request',
    );
    assert.equal(
      await codeOf(test.hub.enroll({ ...VERSION, deviceId: 'pc', deviceName: 'PC' })),
      'invalid_request',
    );
  });
});
