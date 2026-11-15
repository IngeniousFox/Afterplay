import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NodeSqlStorage } from '../../core/node/nodeStorage';
import {
  ENROLL_LOCK_MS,
  ENROLL_MAX_FAILURES,
  ENROLL_WINDOW_MS,
  EnrollThrottle,
  claimTenantIdentity,
  readTenantIdentity,
  TenantService,
} from '../src/tenantService';
import type { EnrollRequest } from '../../../src/shared/sync/protocol';
import { T0, VERSION } from './helpers';

function makeService(): { service: TenantService; time: { now: number }; storage: NodeSqlStorage } {
  const time = { now: T0 };
  const storage = new NodeSqlStorage();
  const service = new TenantService(storage, () => time.now, { tenantId: 'abc123' });
  return { service, time, storage };
}

const enrollRequest = (code: string): EnrollRequest => ({
  ...VERSION,
  code,
  deviceId: 'pc',
  deviceName: 'PC',
});

describe('EnrollThrottle', () => {
  it('bloquea tras el máximo de fallos y desbloquea al pasar el tiempo', () => {
    const time = { now: T0 };
    const throttle = new EnrollThrottle(new NodeSqlStorage(), () => time.now);
    for (let i = 0; i < ENROLL_MAX_FAILURES - 1; i++) {
      throttle.recordFailure();
      assert.equal(throttle.lockedForSec(), 0);
    }
    throttle.recordFailure();
    assert.equal(throttle.lockedForSec(), ENROLL_LOCK_MS / 1000);
    time.now += ENROLL_LOCK_MS - 1000;
    assert.equal(throttle.lockedForSec(), 1);
    time.now += 1000;
    assert.equal(throttle.lockedForSec(), 0);
  });

  it('los fallos fuera de la ventana no se acumulan', () => {
    const time = { now: T0 };
    const throttle = new EnrollThrottle(new NodeSqlStorage(), () => time.now);
    for (let i = 0; i < ENROLL_MAX_FAILURES - 1; i++) throttle.recordFailure();
    time.now += ENROLL_WINDOW_MS + 1;
    throttle.recordFailure();
    assert.equal(throttle.lockedForSec(), 0);
  });

  it('un canje correcto reinicia la cuenta', async () => {
    const { service } = makeService();
    for (let i = 0; i < ENROLL_MAX_FAILURES - 1; i++) {
      const bad = await service.enroll(enrollRequest('AAAAA-AAAAA'));
      assert.equal(bad.ok, false);
    }
    const created = await service.createEnrollmentCode();
    assert.ok(created.ok);
    assert.equal((await service.enroll(enrollRequest(created.value.code))).ok, true);
    // Si la cuenta no se hubiera reiniciado, este fallo ya bloquearía.
    await service.enroll(enrollRequest('AAAAA-AAAAA'));
    const next = await service.enroll(enrollRequest('AAAAA-AAAAA'));
    assert.equal(next.ok === false && next.retryAfterSec, undefined);
  });

  it('los errores de formato no cuentan como intento de adivinar', async () => {
    const { service } = makeService();
    for (let i = 0; i < 10; i++) {
      const outcome = await service.enroll({ ...VERSION } as never);
      assert.equal(outcome.ok === false && outcome.error.error, 'invalid_request');
    }
    const outcome = await service.enroll(enrollRequest('AAAAA-AAAAA'));
    assert.equal(outcome.ok === false && outcome.retryAfterSec, undefined);
  });
});

describe('TenantService', () => {
  it('traduce HubError a valor y no lanza', async () => {
    const { service } = makeService();
    const outcome = await service.status('ap1.abc123.' + 'x'.repeat(43), VERSION);
    assert.deepEqual(outcome.ok === false && outcome.error.error, 'unauthorized');
  });

  it('createEnrollmentCode con TTL fuera de rango es invalid_request', async () => {
    const { service } = makeService();
    const outcome = await service.createEnrollmentCode(0);
    assert.equal(outcome.ok === false && outcome.error.error, 'invalid_request');
  });

  it('sweep ejecuta el barrido del núcleo y limpia el contador', async () => {
    const { service, time } = makeService();
    await service.createEnrollmentCode(1);
    time.now += 2 * 60_000;
    assert.equal(service.sweep().deletedEnrollmentCodes, 1);
  });
});

describe('identidad del inquilino', () => {
  it('se fija con la primera llamada y las siguientes deben coincidir', () => {
    const storage = new NodeSqlStorage();
    assert.equal(readTenantIdentity(storage), null);
    claimTenantIdentity(storage, 'abc123');
    claimTenantIdentity(storage, 'abc123');
    assert.equal(readTenantIdentity(storage), 'abc123');
    assert.throws(() => claimTenantIdentity(storage, 'zzzzzz'), /abc123/);
    assert.equal(readTenantIdentity(storage), 'abc123');
  });
});
