import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  JobClaimRequest,
  JobClaimResponse,
  JobDoneRequest,
  JobKind,
} from '../../../shared/sync/protocol';
import { SyncRequestError } from '../../../shared/sync/protocol';
import {
  JOB_TTL_SEC,
  PAID_JOB_KINDS,
  createJobClaims,
  decideStart,
  isPaidJob,
  isoWeekKey,
  memoryJobKey,
  runLeased,
  type ClaimResult,
  type JobClaims,
  type JobTransport,
} from '../jobClaims';

// Las reglas de §14.3 del lado del cliente: cuándo corre un trabajo según lo
// que conteste el hub, y cómo se cierra la concesión. Todo con un transporte
// de mentira: ni red ni hub.

const GRANTED: ClaimResult = { status: 'granted', leaseId: 'l1', expiresAt: 1 };
const DENIED: ClaimResult = { status: 'denied', holderDeviceId: 'otro', expiresAt: 1 };
const UNAVAILABLE: ClaimResult = { status: 'unavailable', reason: 'red' };
const NO_HUB: ClaimResult = { status: 'no_hub' };

const KINDS: readonly JobKind[] = ['memory', 'curiosities', 'radar', 'refresh_all', 'enrich'];

describe('decideStart (§14.3)', () => {
  it('concedida: corre cualquier trabajo', () => {
    for (const kind of KINDS) assert.equal(decideStart(kind, GRANTED), 'run');
  });

  it('denegada: no corre ninguno (otro PC la tiene o ya terminó)', () => {
    for (const kind of KINDS) assert.equal(decideStart(kind, DENIED), 'skip_denied');
  });

  it('hub sin responder: los de pago NO corren; los demás corren en local', () => {
    for (const kind of KINDS) {
      assert.equal(
        decideStart(kind, UNAVAILABLE),
        isPaidJob(kind) ? 'skip_unavailable' : 'run',
        kind,
      );
    }
    assert.deepEqual([...PAID_JOB_KINDS].sort(), ['curiosities', 'memory']);
  });

  it('sin hub emparejado: todo corre como hoy', () => {
    for (const kind of KINDS) assert.equal(decideStart(kind, NO_HUB), 'run');
  });

  it('un trabajo que solo existe con hub (enrich) no corre sin él', () => {
    assert.equal(decideStart('enrich', NO_HUB, { requireHub: true }), 'skip_no_hub');
    // Con hub la regla es la de siempre.
    assert.equal(decideStart('enrich', UNAVAILABLE, { requireHub: true }), 'run');
    assert.equal(decideStart('enrich', GRANTED, { requireHub: true }), 'run');
  });
});

describe('plazos y claves', () => {
  it('los trabajos de pago piden plazos largos (horas) y ninguno pasa del máximo del hub', () => {
    assert.ok(JOB_TTL_SEC.memory >= 12 * 3600);
    assert.ok(JOB_TTL_SEC.curiosities >= 6 * 3600);
    for (const kind of KINDS) assert.ok(JOB_TTL_SEC[kind] <= 24 * 3600, kind);
  });

  it('la clave de un recap es el periodo', () => {
    assert.equal(memoryJobKey('month', '2026-06'), 'month:2026-06');
    assert.equal(memoryJobKey('year', '2025'), 'year:2025');
  });

  it('la semana ISO se cuenta en UTC y respeta el cambio de año', () => {
    assert.equal(isoWeekKey(Date.UTC(2026, 10, 15, 12)), '2026-W46'); // domingo
    assert.equal(isoWeekKey(Date.UTC(2026, 10, 16, 0, 0)), '2026-W47'); // lunes
    assert.equal(isoWeekKey(Date.UTC(2026, 0, 1)), '2026-W01');
    assert.equal(isoWeekKey(Date.UTC(2027, 0, 1)), '2026-W53'); // viernes: aún del año anterior
    assert.equal(isoWeekKey(Date.UTC(2024, 11, 30)), '2025-W01'); // lunes: ya del siguiente
  });
});

interface FakeHub {
  transport: JobTransport;
  claims: JobClaimRequest[];
  dones: JobDoneRequest[];
}

function fakeHub(options: {
  claim?: (request: JobClaimRequest) => JobClaimResponse;
  done?: () => void;
}): FakeHub {
  const claims: JobClaimRequest[] = [];
  const dones: JobDoneRequest[] = [];
  return {
    claims,
    dones,
    transport: {
      claimJob: async (request) => {
        claims.push(request);
        if (!options.claim) throw new SyncRequestError('network', 'sin red');
        return options.claim(request);
      },
      doneJob: async (request) => {
        dones.push(request);
        options.done?.();
        return { closed: true };
      },
    },
  };
}

const grant = (request: JobClaimRequest): JobClaimResponse => ({
  granted: true,
  leaseId: 'lease-1',
  expiresAt: request.ttlSec,
});

describe('createJobClaims', () => {
  it('sin transporte: no_hub, y cerrar no hace nada', async () => {
    const claims = createJobClaims({ transport: () => null });
    assert.deepEqual(await claims.claim('memory', 'month:2026-06'), { status: 'no_hub' });
    await claims.done('x', 'ok');
  });

  it('traduce la respuesta del hub y usa el plazo del tipo por defecto', async () => {
    const hub = fakeHub({ claim: grant });
    const claims = createJobClaims({ transport: () => hub.transport });
    const result = await claims.claim('memory', 'month:2026-06');
    assert.deepEqual(result, {
      status: 'granted',
      leaseId: 'lease-1',
      expiresAt: JOB_TTL_SEC.memory,
    });
    assert.deepEqual(hub.claims, [
      { kind: 'memory', key: 'month:2026-06', ttlSec: JOB_TTL_SEC.memory },
    ]);

    const denied = createJobClaims({
      transport: () =>
        fakeHub({ claim: () => ({ granted: false, holderDeviceId: 'b', expiresAt: 9 }) }).transport,
    });
    assert.deepEqual(await denied.claim('radar', '2026-W46'), {
      status: 'denied',
      holderDeviceId: 'b',
      expiresAt: 9,
    });
  });

  it('cualquier fallo del hub es unavailable y nunca lanza', async () => {
    const hub = fakeHub({});
    const claims = createJobClaims({ transport: () => hub.transport });
    const result = await claims.claim('curiosities', 'g1');
    assert.equal(result.status, 'unavailable');
  });

  it('un fallo al cerrar se anota y no lanza', async () => {
    const warnings: string[] = [];
    const hub = fakeHub({
      done: () => {
        throw new Error('sin red');
      },
    });
    const claims = createJobClaims({
      transport: () => hub.transport,
      logger: { warn: (message) => warnings.push(message) },
    });
    await claims.done('lease-1', 'failed', 'motivo');
    assert.equal(warnings.length, 1);
  });
});

describe('runLeased', () => {
  const setup = (
    claim?: (request: JobClaimRequest) => JobClaimResponse,
  ): { hub: FakeHub; claims: JobClaims } => {
    const hub = fakeHub({ claim });
    return { hub, claims: createJobClaims({ transport: () => hub.transport }) };
  };

  it('concedida y bien: ejecuta y cierra con ok', async () => {
    const { hub, claims } = setup(grant);
    const run = await runLeased(claims, { kind: 'memory', key: 'month:2026-06' }, async () => 7);
    assert.ok(run.ran);
    assert.equal(run.value, 7);
    assert.deepEqual(hub.dones, [{ leaseId: 'lease-1', outcome: 'ok' }]);
  });

  it('un rechazo del modelo (devuelve false) cierra como fallo con motivo, sin lanzar', async () => {
    const { hub, claims } = setup(grant);
    const run = await runLeased(
      claims,
      { kind: 'memory', key: 'month:2026-06' },
      async () => false,
      (written) => (written ? null : 'el modelo rechazo generar el recap'),
    );
    assert.ok(run.ran);
    assert.deepEqual(hub.dones, [
      { leaseId: 'lease-1', outcome: 'failed', reason: 'el modelo rechazo generar el recap' },
    ]);
  });

  it('si el trabajo lanza: cierra como fallo y relanza el error', async () => {
    const { hub, claims } = setup(grant);
    await assert.rejects(
      runLeased(claims, { kind: 'curiosities', key: 'g1' }, async () => {
        throw new Error('429 del modelo');
      }),
      /429 del modelo/,
    );
    assert.deepEqual(hub.dones, [
      { leaseId: 'lease-1', outcome: 'failed', reason: '429 del modelo' },
    ]);
  });

  it('denegada: no ejecuta y no cierra nada', async () => {
    const { hub, claims } = setup(() => ({ granted: false, holderDeviceId: 'b', expiresAt: 5 }));
    let ran = false;
    const run = await runLeased(claims, { kind: 'memory', key: 'month:2026-06' }, async () => {
      ran = true;
    });
    assert.equal(run.ran, false);
    assert.equal(!run.ran && run.reason, 'skip_denied');
    assert.equal(ran, false);
    assert.deepEqual(hub.dones, []);
  });

  it('hub sin responder: un trabajo de pago no corre; uno barato corre sin concesión', async () => {
    const { hub, claims } = setup();
    let paid = 0;
    const blocked = await runLeased(claims, { kind: 'memory', key: 'k' }, async () => {
      paid++;
    });
    assert.equal(blocked.ran, false);
    assert.equal(!blocked.ran && blocked.reason, 'skip_unavailable');
    assert.equal(paid, 0);

    const cheap = await runLeased(claims, { kind: 'radar', key: '2026-W46' }, async () => 'hecho');
    assert.ok(cheap.ran);
    assert.equal(cheap.value, 'hecho');
    assert.deepEqual(hub.dones, [], 'sin concesión no hay nada que cerrar');
  });

  it('sin hub emparejado: todo corre como hoy, también los de pago', async () => {
    const claims = createJobClaims({ transport: () => null });
    for (const kind of KINDS.filter((k) => k !== 'enrich')) {
      const run = await runLeased(claims, { kind, key: 'k' }, async () => 1);
      assert.ok(run.ran, kind);
    }
    const enrich = await runLeased(
      claims,
      { kind: 'enrich', key: 'g', requireHub: true },
      async () => 1,
    );
    assert.equal(enrich.ran, false);
    assert.equal(!enrich.ran && enrich.reason, 'skip_no_hub');
  });
});
