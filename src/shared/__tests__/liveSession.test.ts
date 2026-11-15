import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_SIGNAL_AFTER_MS,
  canStopLiveSession,
  formatSignalAge,
  hasNoSignal,
  isLiveElsewhere,
  isOwnLiveSession,
  lastSignalAt,
  type LiveSessionSignal,
  signalAgeMs,
} from '../liveSession';

// La regla de "sesión en vivo en otro dispositivo" (§10.8): señal, propiedad y
// quién puede pararla. Todo con datos inventados.

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

const session = (
  heartbeatMinutesAgo: number | null,
  startedMinutesAgo = 60,
): LiveSessionSignal => ({
  startedAt: new Date(T0 - startedMinutesAgo * MIN),
  lastHeartbeatAt: heartbeatMinutesAgo === null ? null : new Date(T0 - heartbeatMinutesAgo * MIN),
});

describe('NO_SIGNAL_AFTER_MS', () => {
  it('son 3 minutos (§10.8)', () => {
    assert.equal(NO_SIGNAL_AFTER_MS, 3 * MIN);
  });
});

describe('hasNoSignal', () => {
  it('con señal reciente no avisa', () => {
    assert.equal(hasNoSignal(session(1), T0), false);
  });

  it('justo 3 minutos todavía no; un milisegundo más sí', () => {
    assert.equal(hasNoSignal(session(3), T0), false);
    assert.equal(hasNoSignal(session(3), T0 + 1), true);
  });

  it('más de 3 minutos avisa', () => {
    assert.equal(hasNoSignal(session(10), T0), true);
  });

  it('sin latido nunca, cuenta desde el arranque', () => {
    assert.equal(hasNoSignal(session(null, 2), T0), false);
    assert.equal(hasNoSignal(session(null, 5), T0), true);
  });

  it('un latido del futuro (relojes de dos PCs que no cuadran) no es falta de señal', () => {
    const future = { startedAt: new Date(T0 - 60 * MIN), lastHeartbeatAt: new Date(T0 + 5 * MIN) };
    assert.equal(hasNoSignal(future, T0), false);
    assert.equal(signalAgeMs(future, T0), 0);
  });
});

describe('lastSignalAt', () => {
  it('el último latido, o el arranque si no hubo', () => {
    const withBeat = session(2);
    assert.equal(lastSignalAt(withBeat), withBeat.lastHeartbeatAt);
    const without = session(null);
    assert.equal(lastSignalAt(without), without.startedAt);
  });
});

describe('formatSignalAge', () => {
  it('minutos, horas con minutos y días con horas', () => {
    assert.equal(formatSignalAge(4 * MIN), '4 min');
    assert.equal(formatSignalAge(59 * MIN), '59 min');
    assert.equal(formatSignalAge(60 * MIN), '1 h');
    assert.equal(formatSignalAge(125 * MIN), '2 h 5 min');
    assert.equal(formatSignalAge(24 * 60 * MIN), '1 d');
    assert.equal(formatSignalAge((24 * 60 + 3 * 60) * MIN), '1 d 3 h');
  });

  it('nunca dice 0 min', () => {
    assert.equal(formatSignalAge(0), '1 min');
    assert.equal(formatSignalAge(20_000), '1 min');
  });
});

describe('isOwnLiveSession / canStopLiveSession', () => {
  const own = { deviceId: 'pc-a', startedBy: 'watcher' };
  const remoteWatcher = { deviceId: 'pc-b', startedBy: 'watcher' };
  const remotePlay = { deviceId: 'pc-b', startedBy: 'play' };
  const remoteTimer = { deviceId: 'pc-b', startedBy: 'timer' };

  it('la de este PC es propia y se puede parar', () => {
    assert.equal(isOwnLiveSession(own, 'pc-a'), true);
    assert.equal(canStopLiveSession(own, 'pc-a'), true);
  });

  it('la de otro PC es ajena y NO se puede parar', () => {
    assert.equal(isOwnLiveSession(remoteWatcher, 'pc-a'), false);
    assert.equal(canStopLiveSession(remoteWatcher, 'pc-a'), false);
    assert.equal(canStopLiveSession(remotePlay, 'pc-a'), false);
  });

  it('un cronómetro ajeno SÍ se puede parar desde aquí', () => {
    assert.equal(isOwnLiveSession(remoteTimer, 'pc-a'), false);
    assert.equal(canStopLiveSession(remoteTimer, 'pc-a'), true);
  });

  it('sin saber cuál es este PC (lista aún sin cargar) se trata como propia', () => {
    assert.equal(isOwnLiveSession(remoteWatcher, null), true);
    assert.equal(canStopLiveSession(remoteWatcher, null), true);
  });
});

describe('isLiveElsewhere', () => {
  it('solo si está en vivo, se conoce este PC y el dispositivo es otro', () => {
    assert.equal(isLiveElsewhere({ isLive: true, liveDeviceId: 'pc-b' }, 'pc-a'), true);
    assert.equal(isLiveElsewhere({ isLive: true, liveDeviceId: 'pc-a' }, 'pc-a'), false);
    assert.equal(isLiveElsewhere({ isLive: false, liveDeviceId: 'pc-b' }, 'pc-a'), false);
    assert.equal(isLiveElsewhere({ isLive: true, liveDeviceId: null }, 'pc-a'), false);
    assert.equal(isLiveElsewhere({ isLive: true }, 'pc-a'), false);
    assert.equal(isLiveElsewhere({ isLive: true, liveDeviceId: 'pc-b' }, null), false);
  });
});
