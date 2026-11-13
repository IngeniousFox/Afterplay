import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count } from '../../../__tests__/helpers';
import { LAST_SEEN_INTERVAL_MS, ensureThisDevice, type ThisDeviceInfo } from '../device';
import { LOCAL, T0, at, hours, openQueryDb, type QueryFixture } from './fixtures';

// La fila de `devices` de este PC (CONSULTAS.md §3.1).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb({ withThisDevice: false });
});
afterEach(() => fx.close());

const info = (extra: Partial<ThisDeviceInfo> = {}): ThisDeviceInfo => ({
  name: 'PC-A',
  home: 'C:\\Users\\ana',
  appVersion: '2.0.0',
  schemaVersion: 1,
  now: new Date(T0),
  ...extra,
});

const dirty = (): number => count(fx.local, 'devices', 'syncDirty = 1');

describe('ensureThisDevice', () => {
  it('crea la fila con el id de este dispositivo la primera vez', () => {
    const { outcome, device } = ensureThisDevice(fx.ctx, info());
    assert.equal(outcome, 'created');
    assert.equal(device.id, LOCAL);
    assert.equal(device.kind, 'desktop');
    assert.equal(device.os, 'windows');
    assert.equal(device.name, 'PC-A');
    assert.equal(device.home, 'C:\\Users\\ana');
    assert.equal(device.appVersion, '2.0.0');
    assert.equal(device.schemaVersion, 1);
    assert.equal(device.firstSeenAt.getTime(), T0);
    assert.equal(device.lastSeenAt?.getTime(), T0);
  });

  it('arrancar otra vez el mismo día con la misma versión no escribe nada', () => {
    ensureThisDevice(fx.ctx, info());
    fx.local.db.$client.prepare('UPDATE devices SET syncDirty = 0').run();
    const { outcome } = ensureThisDevice(fx.ctx, info({ now: at(hours(5)) }));
    assert.equal(outcome, 'unchanged');
    assert.equal(dirty(), 0);
  });

  it('actualiza appVersion y schemaVersion cuando cambian, sin tocar lastSeenAt antes de 24 h', () => {
    ensureThisDevice(fx.ctx, info());
    const { outcome, device } = ensureThisDevice(
      fx.ctx,
      info({ appVersion: '2.0.1', schemaVersion: 2, now: at(hours(1)) }),
    );
    assert.equal(outcome, 'updated');
    assert.equal(device.appVersion, '2.0.1');
    assert.equal(device.schemaVersion, 2);
    assert.equal(device.lastSeenAt?.getTime(), T0);
  });

  it('lastSeenAt como mucho una vez cada 24 h', () => {
    ensureThisDevice(fx.ctx, info());
    const almost = ensureThisDevice(fx.ctx, info({ now: at(LAST_SEEN_INTERVAL_MS - 1) }));
    assert.equal(almost.outcome, 'unchanged');
    const next = ensureThisDevice(fx.ctx, info({ now: at(LAST_SEEN_INTERVAL_MS) }));
    assert.equal(next.outcome, 'updated');
    assert.equal(next.device.lastSeenAt?.getTime(), T0 + LAST_SEEN_INTERVAL_MS);
  });

  it('el nombre solo se escribe al crear: el que puso el usuario se respeta', () => {
    ensureThisDevice(fx.ctx, info());
    fx.ctx.store.patch('devices', LOCAL, { name: 'Sobremesa' });
    const { device } = ensureThisDevice(fx.ctx, info({ name: 'DESKTOP-1234' }));
    assert.equal(device.name, 'Sobremesa');
  });

  it('la carpeta de usuario se actualiza si cambia', () => {
    ensureThisDevice(fx.ctx, info());
    const { outcome, device } = ensureThisDevice(fx.ctx, info({ home: 'D:\\Users\\ana' }));
    assert.equal(outcome, 'updated');
    assert.equal(device.home, 'D:\\Users\\ana');
  });
});
