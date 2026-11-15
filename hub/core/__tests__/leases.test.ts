import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HubError, LEASE_RETENTION_MS, type HubDevice } from '../hub';
import { T0, makeHub } from './helpers';

const pc1: HubDevice = {
  tokenId: 't1',
  deviceId: 'pc-1',
  deviceName: 'Uno',
  shortDeviceId: 'aaaaaa',
};
const pc2: HubDevice = {
  tokenId: 't2',
  deviceId: 'pc-2',
  deviceName: 'Dos',
  shortDeviceId: 'bbbbbb',
};

const claim = { kind: 'memory', key: 'month:2026-06', ttlSec: 60 } as const;

describe('concesiones de trabajo (§14.3)', () => {
  it('concede si no hay concesión viva y la deniega mientras dure', () => {
    const { hub, time } = makeHub();
    const first = hub.claimJob(pc1, claim);
    assert.ok(first.granted);
    assert.equal(first.expiresAt, T0 + 60_000);
    assert.match(first.leaseId, /^[0-9a-f-]{36}$/);

    for (const device of [pc1, pc2]) {
      const denied = hub.claimJob(device, claim);
      assert.deepEqual(denied, { granted: false, holderDeviceId: 'pc-1', expiresAt: T0 + 60_000 });
    }
    // Otro par (kind, key) es independiente.
    assert.ok(hub.claimJob(pc2, { ...claim, key: 'month:2026-07' }).granted);
    assert.ok(hub.claimJob(pc2, { ...claim, kind: 'curiosities' }).granted);

    // Al llegar la caducidad, y aunque el barrido no haya pasado, ya no está viva.
    time.now = T0 + 60_000;
    assert.ok(hub.claimJob(pc2, claim).granted);
  });

  it('caduca con el barrido y deja constancia', () => {
    const { hub, time, storage } = makeHub();
    hub.claimJob(pc1, claim);
    time.now = T0 + 30_000;
    assert.deepEqual(hub.sweep(), {
      expiredLeases: 0,
      deletedLeases: 0,
      deletedEnrollmentCodes: 0,
      abandonedSessions: 0,
    });
    time.now = T0 + 61_000;
    assert.equal(hub.sweep().expiredLeases, 1);
    assert.equal(storage.exec(`SELECT outcome FROM job_leases`)[0].outcome, 'expired');
    assert.ok(hub.claimJob(pc2, claim).granted);
    // Barrer otra vez no repite nada.
    assert.equal(hub.sweep().expiredLeases, 0);
  });

  it('`done ok` cierra la concesión pero no libera el par hasta su caducidad', () => {
    const { hub, time } = makeHub();
    const lease = hub.claimJob(pc1, claim);
    assert.ok(lease.granted);
    assert.deepEqual(hub.doneJob(pc1, { leaseId: lease.leaseId, outcome: 'ok' }), { closed: true });
    // Cerrarla dos veces no vale.
    assert.deepEqual(hub.doneJob(pc1, { leaseId: lease.leaseId, outcome: 'ok' }), {
      closed: false,
    });
    // Un PC que aún no ha bajado el resultado no vuelve a pagar el trabajo.
    for (const device of [pc1, pc2]) {
      assert.deepEqual(hub.claimJob(device, claim), {
        granted: false,
        holderDeviceId: 'pc-1',
        expiresAt: T0 + 60_000,
      });
    }
    time.now = T0 + 60_000;
    assert.ok(hub.claimJob(pc2, claim).granted);
  });

  it('`done failed` anota el motivo', () => {
    const { hub, storage } = makeHub();
    const lease = hub.claimJob(pc1, claim);
    assert.ok(lease.granted);
    hub.doneJob(pc1, {
      leaseId: lease.leaseId,
      outcome: 'failed',
      reason: 'el modelo rechazó la petición',
    });
    // Un fallo reciente no se reintenta en bucle: el par sigue ocupado.
    assert.equal(hub.claimJob(pc2, claim).granted, false);
    const row = storage.exec(
      `SELECT outcome, reason, deviceId FROM job_leases WHERE id = ?`,
      lease.leaseId,
    )[0];
    assert.deepEqual(
      { ...row },
      {
        outcome: 'failed',
        reason: 'el modelo rechazó la petición',
        deviceId: 'pc-1',
      },
    );
  });

  it('solo el dueño cierra su concesión', () => {
    const { hub } = makeHub();
    const lease = hub.claimJob(pc1, claim);
    assert.ok(lease.granted);
    assert.deepEqual(hub.doneJob(pc2, { leaseId: lease.leaseId, outcome: 'ok' }), {
      closed: false,
    });
    assert.deepEqual(hub.doneJob(pc1, { leaseId: 'no-existe', outcome: 'ok' }), { closed: false });
    assert.equal(hub.claimJob(pc2, claim).granted, false);
  });

  it('cierra una concesión caducada que aún no se barrió', () => {
    const { hub, time } = makeHub();
    const lease = hub.claimJob(pc1, claim);
    assert.ok(lease.granted);
    time.now = T0 + 120_000;
    assert.deepEqual(
      hub.doneJob(pc1, { leaseId: lease.leaseId, outcome: 'failed', reason: 'tarde' }),
      { closed: true },
    );
  });

  it('valida kind, key y ttl', () => {
    const { hub } = makeHub();
    const code = (fn: () => unknown): string => {
      try {
        fn();
      } catch (error) {
        return error instanceof HubError ? error.code : 'otro';
      }
      return 'no lanzó';
    };
    assert.equal(
      code(() => hub.claimJob(pc1, { ...claim, kind: 'otro' as never })),
      'invalid_request',
    );
    assert.equal(
      code(() => hub.claimJob(pc1, { ...claim, key: '' })),
      'invalid_request',
    );
    assert.equal(
      code(() => hub.claimJob(pc1, { ...claim, ttlSec: 0 })),
      'invalid_request',
    );
    assert.equal(
      code(() => hub.claimJob(pc1, { ...claim, ttlSec: 1e9 })),
      'invalid_request',
    );
    assert.equal(
      code(() => hub.doneJob(pc1, { leaseId: 'x', outcome: 'quizá' as never })),
      'invalid_request',
    );
  });

  it('el barrido borra las concesiones viejas y los códigos caducados o agotados', async () => {
    const { hub, time, storage } = makeHub();
    hub.claimJob(pc1, claim);
    await hub.createEnrollmentCode({ ttlMinutes: 5 });
    await hub.createEnrollmentCode({ ttlMinutes: 600 });
    time.now = T0 + 10 * 60_000;
    const first = hub.sweep();
    assert.equal(first.expiredLeases, 1);
    assert.equal(first.deletedEnrollmentCodes, 1);
    assert.equal(storage.exec('SELECT COUNT(*) AS c FROM enrollment_codes')[0].c, 1);
    assert.equal(first.deletedLeases, 0, 'se conserva un tiempo, con su motivo');
    time.now += LEASE_RETENTION_MS + 1;
    const later = hub.sweep();
    assert.equal(later.deletedLeases, 1);
    assert.equal(storage.exec('SELECT COUNT(*) AS c FROM job_leases')[0].c, 0);
  });
});
