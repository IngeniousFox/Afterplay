import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { rawRow } from '../../../__tests__/helpers';
import { isStoreError, type ForeignWrite } from '../../../store';
import { closeOwnSession } from '../../common';
import {
  asOtherDevice,
  at,
  hours,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  type OtherDevice,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { TIMER_CLOSE_COLUMNS, timerForeignWriteRule } from '../timerRule';

// Parar un cronómetro desde cualquier PC (§7.4, §13.3). Datos inventados.

let fx: QueryFixture;
let web: OtherDevice;
let playthroughId: string;
beforeEach(() => {
  fx = openQueryDb({ foreignWriteRules: [timerForeignWriteRule] });
  playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'Celeste' }) });
  web = asOtherDevice(fx.ctx, { deviceId: 'web', name: 'Movil' });
});
afterEach(() => fx.close());

const notOwner = (error: unknown): boolean => isStoreError(error, 'not_owner');

describe('parar un cronómetro ajeno', () => {
  it('un PC para un cronómetro de web cuando lo pide una persona', () => {
    const id = web.seedSession({
      playthroughId,
      startedAt: at(0),
      endedAt: null,
      startedBy: 'timer',
    });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(1)), closedBy: 'user' });
    assert.equal(result.status, 'closed');
    const row = rawRow(fx.local, 'sessions', id);
    assert.equal(row?.durationSec, 3600);
    assert.equal(row?.closedBy, 'user');
    assert.equal(row?.deviceId, 'web', 'el dueño no cambia');
  });

  it('una sesión watcher ajena sigue sin poder cerrarse', () => {
    const id = web.seedSession({ playthroughId, endedAt: null, startedBy: 'watcher' });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(1)), closedBy: 'user' });
    assert.equal(result.status, 'not_owner');
    assert.equal(rawRow(fx.local, 'sessions', id)?.endedAt, null);
  });

  it('una sesión play ajena tampoco', () => {
    const id = web.seedSession({ playthroughId, endedAt: null, startedBy: 'play' });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(1)), closedBy: 'user' });
    assert.equal(result.status, 'not_owner');
  });

  it('un cierre automático de un cronómetro ajeno sigue sin funcionar', () => {
    const id = web.seedSession({ playthroughId, endedAt: null, startedBy: 'timer' });
    for (const closedBy of ['owner', 'janitor'] as const) {
      const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(1)), closedBy });
      assert.equal(result.status, 'not_owner');
    }
    assert.equal(rawRow(fx.local, 'sessions', id)?.endedAt, null);
  });

  it('un cronómetro ya cerrado no se recalcula', () => {
    const id = web.seedSession({
      playthroughId,
      startedAt: at(0),
      endedAt: at(hours(1)),
      startedBy: 'timer',
    });
    const before = rawRow(fx.local, 'sessions', id);
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(hours(5)), closedBy: 'user' });
    assert.equal(result.status, 'already_closed');
    assert.deepEqual(rawRow(fx.local, 'sessions', id), before);
  });

  it('un fin anterior al inicio lo deja abierto', () => {
    const id = web.seedSession({
      playthroughId,
      startedAt: at(hours(2)),
      endedAt: null,
      startedBy: 'timer',
    });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(0), closedBy: 'user' });
    assert.equal(result.status, 'ends_before_start');
  });

  it('un cronómetro propio se cierra como cualquier sesión propia', () => {
    const id = seedSession(fx.ctx, {
      playthroughId,
      startedAt: at(0),
      endedAt: null,
      startedBy: 'timer',
    });
    const result = closeOwnSession(fx.ctx, id, { endedAt: at(60_000), closedBy: 'owner' });
    assert.equal(result.status, 'closed');
  });

  it('sin la regla registrada la puerta rechaza el cierre', () => {
    fx.close();
    fx = openQueryDb();
    const pt = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'Celeste' }) });
    const id = asOtherDevice(fx.ctx, { deviceId: 'web' }).seedSession({
      playthroughId: pt,
      endedAt: null,
      startedBy: 'timer',
    });
    assert.throws(
      () => closeOwnSession(fx.ctx, id, { endedAt: at(60_000), closedBy: 'user' }),
      notOwner,
    );
  });
});

describe('timerForeignWriteRule en la puerta', () => {
  it('solo admite las columnas del cierre', () => {
    const id = web.seedSession({ playthroughId, endedAt: null, startedBy: 'timer' });
    const forbidden: Record<string, unknown>[] = [
      { startedAt: at(5) },
      { startedBy: 'watcher' },
      { endedAt: at(60_000), startedAt: at(5) },
    ];
    for (const patch of forbidden) {
      assert.throws(() => fx.ctx.store.patch('sessions', id, patch as never), notOwner);
    }
    assert.equal(rawRow(fx.local, 'sessions', id)?.endedAt, null);
    const done = fx.ctx.store.patch('sessions', id, {
      endedAt: at(60_000),
      durationSec: 60,
      closedBy: 'user',
    });
    assert.deepEqual([...done.changed].sort(), ['closedBy', 'durationSec', 'endedAt']);
  });

  it('no deja borrar un cronómetro ajeno abierto', () => {
    const id = web.seedSession({ playthroughId, endedAt: null, startedBy: 'timer' });
    assert.throws(() => fx.ctx.store.remove('sessions', id), notOwner);
  });

  it('la regla en seco: solo patch de sessions sobre un cronómetro abierto', () => {
    const open = { startedBy: 'timer', endedAt: null };
    const patch = (over: Record<string, unknown>): ForeignWrite =>
      ({ kind: 'patch', table: 'sessions', row: open, columns: ['endedAt'], ...over }) as never;
    for (const columns of [[...TIMER_CLOSE_COLUMNS], ['endedAt'], ['closedBy']]) {
      assert.equal(timerForeignWriteRule(patch({ columns })), true);
    }
    assert.equal(timerForeignWriteRule(patch({ columns: ['endedAt', 'note'] })), false);
    assert.equal(timerForeignWriteRule(patch({ columns: ['playthroughId'] })), false);
    assert.equal(timerForeignWriteRule(patch({ row: { ...open, startedBy: 'play' } })), false);
    assert.equal(timerForeignWriteRule(patch({ row: { ...open, endedAt: new Date(0) } })), false);
    assert.equal(timerForeignWriteRule(patch({ table: 'game_installs' })), false);
    assert.equal(timerForeignWriteRule(patch({ table: 'save_backups' })), false);
    assert.equal(timerForeignWriteRule({ kind: 'create', table: 'sessions', values: open }), false);
    assert.equal(timerForeignWriteRule({ kind: 'remove', table: 'sessions', row: open }), false);
  });
});
