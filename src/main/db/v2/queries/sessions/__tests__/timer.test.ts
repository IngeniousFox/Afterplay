import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TIMER_STALE_MS } from '../../../../../../shared/timerFreshness';
import {
  asOtherDevice,
  at,
  hours,
  openQueryDb,
  seedGame,
  type OtherDevice,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  LIVE_ELSEWHERE_MS,
  beatTimer,
  getActiveTimer,
  startTimer,
  stopTimer,
  type ActiveTimer,
} from '../timer';
import { sessionRow, sessionsOfGame } from './helpers';

// El cronómetro del móvil (§13.3, E-13). Aquí `ctx` es el dispositivo `web`,
// que es quien corre estas consultas en el hub. Datos inventados.

const MINUTE = 60_000;

let fx: QueryFixture;
let pc: OtherDevice;
let gameId: string;
beforeEach(() => {
  fx = openQueryDb({ deviceId: 'web' });
  pc = asOtherDevice(fx.ctx, { deviceId: 'pc-b', name: 'PC-B' });
  gameId = seedGame(fx.ctx, { title: 'Celeste' });
});
afterEach(() => fx.close());

const started = (result: ReturnType<typeof startTimer>): ActiveTimer => {
  assert.equal(result.status, 'started');
  return result.status === 'started' ? result.timer : assert.fail('no ha arrancado');
};

describe('arrancar el cronómetro', () => {
  it('crea una sesión de cronómetro del dispositivo web, medida y con su primera señal', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    const row = sessionRow(fx.ctx, timer.sessionId);
    assert.equal(row?.startedBy, 'timer');
    assert.equal(row?.deviceId, 'web');
    assert.equal(row?.source, 'measured');
    assert.equal(row?.datePrecision, 'datetime');
    assert.equal(row?.endedAt, null);
    assert.equal(row?.lastSeenAt?.getTime(), row?.startedAt.getTime());
    assert.equal(timer.gameId, gameId);
    assert.equal(timer.title, 'Celeste');
    assert.equal(getActiveTimer(fx.ctx)?.sessionId, timer.sessionId);
  });

  it('un juego que no existe no arranca nada', () => {
    assert.deepEqual(startTimer(fx.ctx, 'no-existe'), { status: 'game_not_found' });
    assert.equal(getActiveTimer(fx.ctx), null);
  });

  it('como mucho un cronómetro vivo: ni el mismo juego ni otro', () => {
    const first = started(startTimer(fx.ctx, gameId));
    const other = seedGame(fx.ctx, { title: 'Hades' });
    for (const target of [gameId, other]) {
      const again = startTimer(fx.ctx, target);
      assert.equal(again.status, 'timer_running');
      assert.equal(
        again.status === 'timer_running' ? again.timer.sessionId : null,
        first.sessionId,
      );
    }
    assert.equal(sessionsOfGame(fx.ctx, other).length, 0);
  });

  it('se niega si otro dispositivo juega ese juego y dice dónde', () => {
    // Un cronómetro ya parado deja el playthrough del juego, donde juega el PC.
    const first = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, first.sessionId);
    const playthroughId = sessionRow(fx.ctx, first.sessionId)?.playthroughId;
    pc.seedSession({ playthroughId, startedAt: fx.ctx.now(), endedAt: null });
    fx.wall.advance(LIVE_ELSEWHERE_MS - MINUTE);
    const result = startTimer(fx.ctx, gameId);
    assert.deepEqual(result, { status: 'live_elsewhere', deviceId: 'pc-b', deviceName: 'PC-B' });
  });

  it('la sesión ajena que lleva diez minutos sin señal ya no bloquea', () => {
    const first = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, first.sessionId);
    const playthroughId = sessionRow(fx.ctx, first.sessionId)?.playthroughId;
    pc.seedSession({ playthroughId, startedAt: fx.ctx.now(), endedAt: null });
    fx.wall.advance(LIVE_ELSEWHERE_MS);
    assert.equal(startTimer(fx.ctx, gameId).status, 'started');
  });

  it('la señal de vida (lastSeenAt) manda sobre el inicio de la sesión ajena', () => {
    const first = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, first.sessionId);
    const playthroughId = sessionRow(fx.ctx, first.sessionId)?.playthroughId;
    pc.seedSession({
      playthroughId,
      startedAt: fx.ctx.now(),
      endedAt: null,
      lastSeenAt: new Date(fx.ctx.now().getTime() + hours(2)),
    });
    fx.wall.advance(hours(2) + 5 * MINUTE);
    assert.equal(startTimer(fx.ctx, gameId).status, 'live_elsewhere');
  });

  it('una sesión ajena ya cerrada no bloquea', () => {
    const first = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, first.sessionId);
    const playthroughId = sessionRow(fx.ctx, first.sessionId)?.playthroughId;
    pc.seedSession({ playthroughId, startedAt: fx.ctx.now(), endedAt: at(hours(3)) });
    assert.equal(startTimer(fx.ctx, gameId).status, 'started');
  });

  it('un cronómetro rancio (24 h) no cuenta: se cierra en su última señal y deja arrancar', () => {
    const stale = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(TIMER_STALE_MS);
    assert.equal(getActiveTimer(fx.ctx), null, 'rancio = no vivo');

    const fresh = started(startTimer(fx.ctx, gameId));
    assert.notEqual(fresh.sessionId, stale.sessionId);
    const old = sessionRow(fx.ctx, stale.sessionId);
    assert.equal(old?.closedBy, 'janitor');
    assert.equal(old?.endedAt?.getTime(), old?.startedAt.getTime(), 'sin latidos: duración cero');
    assert.equal(old?.durationSec, 0);
  });
});

describe('el latido', () => {
  it('actualiza lastSeenAt y dice que sigue vivo', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(5 * MINUTE);
    assert.equal(beatTimer(fx.ctx, timer.sessionId), true);
    assert.equal(
      sessionRow(fx.ctx, timer.sessionId)?.lastSeenAt?.getTime(),
      fx.ctx.now().getTime(),
    );
  });

  it('un latido mantiene vivo un cronómetro que sin él estaría rancio', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(TIMER_STALE_MS - MINUTE);
    assert.equal(beatTimer(fx.ctx, timer.sessionId), true);
    fx.wall.advance(TIMER_STALE_MS - MINUTE);
    assert.equal(getActiveTimer(fx.ctx)?.sessionId, timer.sessionId);
  });

  it('dice que no si está rancio, cerrado, no existe o no es un cronómetro', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(TIMER_STALE_MS);
    assert.equal(beatTimer(fx.ctx, timer.sessionId), false, 'rancio');

    assert.equal(beatTimer(fx.ctx, 'no-existe'), false);
    const fresh = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, fresh.sessionId);
    assert.equal(beatTimer(fx.ctx, fresh.sessionId), false, 'cerrado');

    const playthroughId = sessionRow(fx.ctx, fresh.sessionId)?.playthroughId;
    const watcher = pc.seedSession({ playthroughId, endedAt: null });
    assert.equal(beatTimer(fx.ctx, watcher), false, 'no es un cronómetro');
  });
});

describe('parar el cronómetro', () => {
  it('cierra con closedBy user y su duración', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(90 * MINUTE);
    const result = stopTimer(fx.ctx, timer.sessionId);
    assert.equal(result.status, 'stopped');
    const row = sessionRow(fx.ctx, timer.sessionId);
    assert.equal(row?.closedBy, 'user');
    assert.equal(row?.durationSec, 90 * 60);
    assert.equal(getActiveTimer(fx.ctx), null);
    assert.equal(startTimer(fx.ctx, gameId).status, 'started', 'se puede volver a arrancar');
  });

  it('parar dos veces no recalcula la duración', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(10 * MINUTE);
    stopTimer(fx.ctx, timer.sessionId);
    fx.wall.advance(hours(5));
    const again = stopTimer(fx.ctx, timer.sessionId);
    assert.equal(again.status, 'already_stopped');
    assert.equal(sessionRow(fx.ctx, timer.sessionId)?.durationSec, 600);
  });

  it('parar uno rancio lo cierra en su última señal, no ahora', () => {
    const timer = started(startTimer(fx.ctx, gameId));
    fx.wall.advance(30 * MINUTE);
    beatTimer(fx.ctx, timer.sessionId);
    fx.wall.advance(TIMER_STALE_MS + hours(3));
    const result = stopTimer(fx.ctx, timer.sessionId);
    assert.equal(result.status, 'stopped');
    assert.equal(sessionRow(fx.ctx, timer.sessionId)?.durationSec, 30 * 60);
  });

  it('no existe y no es un cronómetro son resultados, no excepciones', () => {
    assert.deepEqual(stopTimer(fx.ctx, 'no-existe'), { status: 'not_found' });
    const timer = started(startTimer(fx.ctx, gameId));
    stopTimer(fx.ctx, timer.sessionId);
    const playthroughId = sessionRow(fx.ctx, timer.sessionId)?.playthroughId;
    const watcher = pc.seedSession({ playthroughId, endedAt: null });
    assert.deepEqual(stopTimer(fx.ctx, watcher), { status: 'not_a_timer' });
  });
});
