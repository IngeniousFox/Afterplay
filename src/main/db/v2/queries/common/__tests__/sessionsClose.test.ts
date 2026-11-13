import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, rawRow } from '../../../__tests__/helpers';
import { StoreError, type WriteStore } from '../../../store';
import type { QueryContext } from '../context';
import { closeOpenOwnSessions, closeOwnSession, computeDurationSec } from '../sessionsClose';
import {
  asOtherDevice,
  at,
  insertSynced,
  hours,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  type QueryFixture,
} from './fixtures';

// Cerrar sesiones propias (R-10, R-12) y su contrato de errores.

let fx: QueryFixture;
let playthroughId: string;
beforeEach(() => {
  fx = openQueryDb();
  playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'Celeste' }) });
});
afterEach(() => fx.close());

describe('closeOwnSession', () => {
  it('cierra con endedAt, durationSec y closedBy', () => {
    const id = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(2) + 400), closedBy: 'user' });
    assert.equal(result.status, 'closed');
    assert.ok(result.status === 'closed');
    assert.equal(result.session.endedAt?.getTime(), at(hours(2) + 400).getTime());
    assert.equal(result.session.durationSec, 7200);
    assert.equal(result.session.closedBy, 'user');
  });

  it('idempotente: una ya cerrada no se recalcula', () => {
    const id = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: at(hours(1)) });
    const before = rawRow(fx.local, 'sessions', id);
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(5)), closedBy: 'owner' });
    assert.equal(result.status, 'already_closed');
    assert.deepEqual(rawRow(fx.local, 'sessions', id), before);
  });

  it('la de otro PC no se toca ni lanza (R-10)', () => {
    const id = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(1)), closedBy: 'user' });
    assert.equal(result.status, 'not_owner');
    assert.equal(rawRow(fx.local, 'sessions', id)?.endedAt, null);
  });

  it('un fin anterior al inicio la deja abierta', () => {
    const id = seedSession(fx.ctx, { playthroughId, startedAt: at(hours(1)), endedAt: null });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(0), closedBy: 'owner' });
    assert.equal(result.status, 'ends_before_start');
    assert.equal(rawRow(fx.local, 'sessions', id)?.endedAt, null);
  });

  it('inexistente o con lápida', () => {
    assert.equal(
      closeOwnSession(fx.ctx, 'no-existe', { endedAt: at(0), closedBy: 'owner' }).status,
      'not_found',
    );
    const id = seedSession(fx.ctx, { playthroughId, endedAt: null });
    fx.ctx.store.remove('sessions', id);
    assert.equal(
      closeOwnSession(fx.ctx, id, { endedAt: at(0), closedBy: 'owner' }).status,
      'deleted',
    );
  });

  it('computeDurationSec redondea y nunca es negativa', () => {
    assert.equal(computeDurationSec(at(0), at(1_499)), 1);
    assert.equal(computeDurationSec(at(0), at(1_500)), 2);
    assert.equal(computeDurationSec(at(10), at(0)), 0);
  });
});

describe('closeOpenOwnSessions', () => {
  it('cierra solo las propias, abiertas y vivas del playthrough; corte >=', () => {
    const atStart = seedSession(fx.ctx, { playthroughId, startedAt: at(hours(3)), endedAt: null });
    const closedAlready = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: at(10) });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });
    const otherPlaythrough = seedPlaythrough(fx.ctx, {
      gameId: seedGame(fx.ctx, { title: 'Hades' }),
    });
    const elsewhere = seedSession(fx.ctx, { playthroughId: otherPlaythrough, endedAt: null });

    const result = closeOpenOwnSessions(fx.ctx, playthroughId, {
      endedAt: at(hours(3)),
      closedBy: 'user',
    });
    assert.deepEqual(
      result.closed.map((s) => s.id),
      [atStart],
    );
    assert.equal(result.closed[0].durationSec, 0);
    assert.deepEqual(result.startedLater, []);
    assert.deepEqual(result.failed, []);
    assert.equal(rawRow(fx.local, 'sessions', foreign)?.endedAt, null);
    assert.equal(rawRow(fx.local, 'sessions', elsewhere)?.endedAt, null);
    assert.equal(rawRow(fx.local, 'sessions', closedAlready)?.durationSec, 0);
  });

  it('las que empezaron después del cierre se dejan abiertas', () => {
    const later = seedSession(fx.ctx, { playthroughId, startedAt: at(hours(5)), endedAt: null });
    const result = closeOpenOwnSessions(fx.ctx, playthroughId, {
      endedAt: at(hours(1)),
      closedBy: 'user',
    });
    assert.deepEqual(result.closed, []);
    assert.deepEqual(
      result.startedLater.map((s) => s.id),
      [later],
    );
  });

  /**
   * Un contexto cuya puerta rechaza el parche de una sesión concreta: con
   * `failWith` un `StoreError` (lo que la puerta lanzaría) o cualquier otro.
   */
  const failingCtx = (sessionId: string, failWith: Error): QueryContext => {
    const real = fx.ctx.store;
    const store = {
      transaction: <T>(fn: () => T): T => real.transaction(fn),
      create: real.create.bind(real),
      remove: real.remove.bind(real),
      patch: ((table, id, changes) => {
        if (id === sessionId) throw failWith;
        return real.patch(table, id, changes);
      }) as WriteStore['patch'],
    } as unknown as WriteStore;
    return { ...fx.ctx, store };
  };

  /** Dos abiertas propias del mismo juego: la puerta no lo deja, pero puede llegar por sync. */
  const twoOpen = (): [string, string] => {
    const first = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    const second = insertSynced(fx.ctx, 'sessions', {
      playthroughId,
      deviceId: fx.ctx.deviceId,
      startedBy: 'watcher',
      startedAt: at(1_000),
      datePrecision: 'datetime',
    });
    return [first, second];
  };

  it('un StoreError en una no tumba el bucle ni la transacción de quien llama', () => {
    const [first, second] = twoOpen();
    const ctx = failingCtx(first, new StoreError('invalid_value', 'rechazada'));

    const result = ctx.store.transaction(() => {
      const closing = closeOpenOwnSessions(ctx, playthroughId, {
        endedAt: at(hours(1)),
        closedBy: 'user',
      });
      // La transacción de quien llama sigue viva: el evento se registra igual.
      seedStateEvent(ctx, { playthroughId, type: 'completed', occurredAt: at(hours(1)) });
      return closing;
    });

    assert.deepEqual(
      result.failed.map((f) => [f.sessionId, f.error.code]),
      [[first, 'invalid_value']],
    );
    assert.deepEqual(
      result.closed.map((s) => s.id),
      [second],
    );
    assert.equal(rawRow(fx.local, 'sessions', first)?.endedAt, null);
    assert.notEqual(rawRow(fx.local, 'sessions', second)?.endedAt, null);
    assert.equal(count(fx.local, 'state_events', "type = 'completed'"), 1);
  });

  it('los errores que no son de la puerta se propagan', () => {
    const [first] = twoOpen();
    const ctx = failingCtx(first, new TypeError('fallo de programación'));
    assert.throws(
      () => closeOpenOwnSessions(ctx, playthroughId, { endedAt: at(hours(1)), closedBy: 'user' }),
      TypeError,
    );
  });
});
