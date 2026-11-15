import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  LOCAL,
  OTHER,
  asOtherDevice,
  at,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getAllSessions } from '../../sessions/read';
import { getGames } from '../getGames';

// "Playing on PC-A" en la biblioteca (§10.8): de qué dispositivo es la sesión en
// vivo del juego.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const game = (title = 'Celeste'): { gameId: string; ptId: string } => {
  const gameId = seedGame(fx.ctx, { title });
  return { gameId, ptId: seedPlaythrough(fx.ctx, { gameId }) };
};

describe('getGames · liveDeviceId', () => {
  it('sin sesión abierta, null y no está en vivo', () => {
    const { ptId } = game();
    seedSession(fx.ctx, { playthroughId: ptId });
    const [item] = getGames(fx.ctx);
    assert.equal(item.isLive, false);
    assert.equal(item.liveDeviceId, null);
  });

  it('una abierta de ESTE PC: su dispositivo', () => {
    const { ptId } = game();
    seedSession(fx.ctx, { playthroughId: ptId, endedAt: null });
    const [item] = getGames(fx.ctx);
    assert.equal(item.isLive, true);
    assert.equal(item.liveDeviceId, LOCAL);
  });

  it('una abierta de OTRO PC: el dispositivo ajeno, y el juego sigue en vivo', () => {
    const { ptId } = game();
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: ptId,
      startedAt: at(60_000),
      endedAt: null,
      startedBy: 'play',
    });
    const [item] = getGames(fx.ctx);
    assert.equal(item.isLive, true);
    assert.equal(item.liveDeviceId, OTHER);
    assert.equal(item.liveSince?.getTime(), at(60_000).getTime());
  });

  it('con una abierta propia y otra ajena MÁS RECIENTE gana la propia, y liveSince es la suya', () => {
    const { ptId } = game();
    seedSession(fx.ctx, { playthroughId: ptId, startedAt: at(1_000), endedAt: null });
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: ptId,
      startedAt: at(9_000),
      endedAt: null,
    });
    const [item] = getGames(fx.ctx);
    assert.equal(item.liveDeviceId, LOCAL);
    assert.equal(item.liveSince?.getTime(), at(1_000).getTime());
  });

  it('un juego en vivo en otro PC y otro parado no se mezclan', () => {
    const live = game('A en vivo');
    game('B parado');
    asOtherDevice(fx.ctx).seedSession({ playthroughId: live.ptId, endedAt: null });
    const items = getGames(fx.ctx);
    assert.equal(items.find((item) => item.title === 'A en vivo')?.liveDeviceId, OTHER);
    assert.equal(items.find((item) => item.title === 'B parado')?.liveDeviceId, null);
  });
});

describe('getAllSessions · startedBy', () => {
  it('lleva quién abrió la sesión: la interfaz decide con él si un cronómetro ajeno se puede parar', () => {
    const { ptId } = game();
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: ptId,
      endedAt: null,
      startedBy: 'timer',
    });
    const [session] = getAllSessions(fx.ctx);
    assert.equal(session.startedBy, 'timer');
    assert.equal(session.deviceId, OTHER);
  });
});
