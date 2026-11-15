import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JobClaimRequest, JobClaimResponse } from '../../../shared/sync/protocol';
import { createJobClaims, type JobTransport } from '../../sync/jobClaims';
import { ENRICH_BATCH, createEnrichRunner } from '../enrichPending';

// La orquestación de "completar los juegos que añadió otro dispositivo"
// (§13.3, §14.3). La base, el refresco y el hub van de mentira: lo que se
// prueba es CUÁNDO se completa un juego y qué se anota en la concesión.

interface Rig {
  claimCalls: JobClaimRequest[];
  dones: { outcome: string; reason?: string }[];
  enriched: string[];
  pending: string[];
  now: { t: number };
  runner: ReturnType<typeof createEnrichRunner>;
}

function rig(options: {
  hub?: 'none' | 'down' | ((request: JobClaimRequest) => JobClaimResponse);
  enrich?: (gameId: string) => Promise<string | null>;
  canRun?: boolean;
  pending?: string[];
}): Rig {
  const claimCalls: JobClaimRequest[] = [];
  const dones: Rig['dones'] = [];
  const enriched: string[] = [];
  const pending = options.pending ?? [];
  const now = { t: 1_000_000 };
  const hub = options.hub ?? ((request) => grant(request));
  const transport: JobTransport = {
    claimJob: async (request) => {
      claimCalls.push(request);
      if (hub === 'down') throw new Error('red caida');
      return (hub as (request: JobClaimRequest) => JobClaimResponse)(request);
    },
    doneJob: async ({ outcome, reason }) => {
      dones.push({ outcome, ...(reason ? { reason } : {}) });
      return { closed: true };
    },
  };
  const claims = createJobClaims({ transport: () => (hub === 'none' ? null : transport) });
  const runner = createEnrichRunner({
    claims,
    select: (limit) => pending.filter((id) => !enriched.includes(id)).slice(0, limit),
    enrich:
      options.enrich ??
      (async (gameId) => {
        enriched.push(gameId);
        return null;
      }),
    canRun: () => options.canRun ?? true,
    now: () => now.t,
  });
  return { claimCalls, dones, enriched, pending, now, runner };
}

const grant = (request: JobClaimRequest): JobClaimResponse => ({
  granted: true,
  leaseId: `lease-${request.key}`,
  expiresAt: request.ttlSec,
});

describe('createEnrichRunner', () => {
  it('pide enrich:<gameId> por cada juego pendiente y lo completa', async () => {
    const r = rig({ pending: ['g1', 'g2'] });
    const summary = await r.runner.run();
    assert.deepEqual(
      r.claimCalls.map(({ kind, key }) => ({ kind, key })),
      [
        { kind: 'enrich', key: 'g1' },
        { kind: 'enrich', key: 'g2' },
      ],
    );
    assert.deepEqual(r.enriched, ['g1', 'g2']);
    assert.deepEqual(r.dones, [{ outcome: 'ok' }, { outcome: 'ok' }]);
    assert.equal(summary.enriched, 2);
  });

  it('sin hub emparejado no hace nada (este trabajo nace del sync)', async () => {
    const r = rig({ hub: 'none', pending: ['g1'] });
    const summary = await r.runner.run();
    assert.deepEqual(r.enriched, []);
    assert.equal(summary.noHub, true);
  });

  it('si otro PC tiene la concesión, se salta el juego y no se le vuelve a pedir enseguida', async () => {
    const r = rig({
      hub: () => ({ granted: false, holderDeviceId: 'otro', expiresAt: 1_000_000 + 60_000 }),
      pending: ['g1'],
    });
    assert.equal((await r.runner.run()).denied, 1);
    assert.deepEqual(r.enriched, []);

    r.claimCalls.length = 0;
    await r.runner.run();
    assert.deepEqual(r.claimCalls, [], 'dentro de su concesión no se insiste');

    // Caducada la concesión del otro PC, vuelve a intentarlo.
    r.now.t += 61_000;
    await r.runner.run();
    assert.equal(r.claimCalls.length, 1);
  });

  it('enrich no es de pago: con el hub sin responder se completa en local, sin cerrar nada', async () => {
    const r = rig({ hub: 'down', pending: ['g1'] });
    const summary = await r.runner.run();
    assert.deepEqual(r.enriched, ['g1']);
    assert.deepEqual(r.dones, []);
    assert.equal(summary.enriched, 1);
  });

  it('un fallo se anota en la concesión con su motivo y no se reintenta en bucle', async () => {
    let calls = 0;
    const r = rig({
      pending: ['g1'],
      enrich: async () => {
        calls++;
        return 'IGDB no contesto';
      },
    });
    const summary = await r.runner.run();
    assert.equal(summary.failed, 1);
    assert.deepEqual(r.dones, [{ outcome: 'failed', reason: 'IGDB no contesto' }]);

    await r.runner.run();
    assert.equal(calls, 1, 'el mismo juego no vuelve a intentarse mientras dure su concesión');
  });

  it('un error al completar no tumba al resto', async () => {
    const r = rig({
      pending: ['g1', 'g2'],
      enrich: async (gameId) => {
        if (gameId === 'g1') throw new Error('boom');
        return null;
      },
    });
    const summary = await r.runner.run();
    assert.equal(summary.failed, 1);
    assert.equal(summary.enriched, 1);
    assert.deepEqual(
      r.dones.map((d) => d.outcome),
      ['failed', 'ok'],
    );
  });

  it('sin credenciales de IGDB no intenta nada ni pide concesiones', async () => {
    const r = rig({ canRun: false, pending: ['g1'] });
    await r.runner.run();
    assert.deepEqual(r.claimCalls, []);
    assert.deepEqual(r.enriched, []);
  });

  it('un juego fallido no ocupa la cabeza de la lista: los siguientes también se completan', async () => {
    const ids = Array.from({ length: ENRICH_BATCH + 2 }, (_, i) => `g${i}`);
    const r = rig({
      pending: ids,
      enrich: async (gameId) => (gameId === 'g0' ? 'fallo' : null),
    });
    const summary = await r.runner.run();
    assert.equal(summary.failed, 1);
    assert.equal(summary.enriched, ids.length - 1);
  });

  it('sin juegos pendientes no molesta al hub', async () => {
    const r = rig({ pending: [] });
    await r.runner.run();
    assert.deepEqual(r.claimCalls, []);
  });
});
