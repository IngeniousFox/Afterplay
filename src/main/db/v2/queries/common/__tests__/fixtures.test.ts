import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gameIdForIgdb, isUuid } from '../../../../../../shared/sync/ids';
import { count, rawRow } from '../../../__tests__/helpers';
import { isStoreError } from '../../../store';
import {
  LOCAL,
  OTHER,
  T0,
  asOtherDevice,
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSaveBackup,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  type QueryFixture,
} from './fixtures';

// Las fixtures también se prueban: las usan ocho paquetes.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('fixtures', () => {
  it('la base nace con este dispositivo y el reloj parado en T0', () => {
    assert.equal(rawRow(fx.local, 'devices', LOCAL)?.name, 'PC-A');
    assert.equal(fx.ctx.deviceId, LOCAL);
    assert.equal(fx.ctx.now().getTime(), T0);
    fx.wall.advance(10);
    assert.equal(fx.ctx.now().getTime(), T0 + 10);
  });

  it('seedGame: id determinista con igdbId, UUIDv7 sin él, y saveKey como el alta', () => {
    const withIgdb = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226 });
    const without = seedGame(fx.ctx, { title: 'Mi juego' });
    assert.equal(withIgdb, gameIdForIgdb(26226));
    assert.ok(isUuid(without));
    assert.equal(rawRow(fx.local, 'games', withIgdb)?.saveKey, '26226');
    assert.equal(rawRow(fx.local, 'games', without)?.saveKey, without);
  });

  it('los seeds de un juego completo pasan por la puerta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', planned: true, install: {} });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId });
    const sessionId = seedSession(fx.ctx, { playthroughId });
    seedSession(fx.ctx, { playthroughId, startedAt: new Date(T0 + 7_200_000), endedAt: null });
    seedSpendEvent(fx.ctx, { gameId });
    seedCatalog(fx.ctx, { gameId });
    seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1', sessionId });
    seedCheck(fx.ctx, { gameId, source: 'hltb', status: 'empty' });
    seedSaveBackup(fx.ctx, { gameId });
    const emulatorId = seedEmulator(fx.ctx, { name: 'Dolphin' });
    seedSession(fx.ctx, { emulatorId, endedAt: null });

    assert.equal(count(fx.local, 'plan_entries'), 1);
    assert.equal(count(fx.local, 'game_installs'), 1);
    assert.equal(count(fx.local, 'sessions'), 3);
    assert.equal(count(fx.local, 'sessions', 'endedAt IS NULL'), 2);
    assert.equal(rawRow(fx.local, 'sessions', sessionId)?.durationSec, 3600);
    assert.equal(rawRow(fx.local, 'sessions', sessionId)?.closedBy, 'owner');
    assert.equal(count(fx.local, 'emulator_installs'), 1);
    // Todo lo sembrado está pendiente de subir, como cualquier escritura local.
    assert.equal(count(fx.local, 'sessions', 'syncDirty = 0'), 0);
  });

  it('la puerta sigue mandando: dos abiertas propias del mismo juego no se pueden sembrar', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    seedSession(fx.ctx, { playthroughId, endedAt: null });
    assert.throws(
      () => seedSession(fx.ctx, { playthroughId, endedAt: null }),
      (error: unknown) => isStoreError(error, 'open_session'),
    );
  });

  it('asOtherDevice escribe filas ajenas "llegadas por sync"', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    const other = asOtherDevice(fx.ctx);
    assert.equal(other.deviceId, OTHER);
    assert.equal(rawRow(fx.local, 'devices', OTHER)?.name, 'PC-B');

    const sessionId = other.seedSession({ playthroughId, endedAt: null });
    const installId = other.seedInstall({ gameId });
    const row = rawRow(fx.local, 'sessions', sessionId);
    assert.equal(row?.deviceId, OTHER);
    assert.equal(row?.syncDirty, 0);
    assert.match(String(row?.syncCreated), /-pcbbbb$/);
    assert.equal(installId, `${gameId}:${OTHER}`);

    // Y la puerta no deja tocarlas desde aquí (la regla del dueño sigue viva).
    assert.throws(
      () => fx.ctx.store.patch('sessions', sessionId, { endedAt: new Date(T0) }),
      (error: unknown) => isStoreError(error, 'not_owner'),
    );
    // Pero una abierta suya no impide abrir una propia del mismo juego.
    seedSession(fx.ctx, { playthroughId, endedAt: null });
  });
});
