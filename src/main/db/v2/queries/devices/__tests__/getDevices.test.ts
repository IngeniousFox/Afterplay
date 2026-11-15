import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  LOCAL,
  OTHER,
  asOtherDevice,
  openQueryDb,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getDevices } from '../getDevices';

// Los dispositivos para la interfaz (§10.8, §11.4): id, nombre, sistema y si
// es este PC. Nada más sale de su fila.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getDevices', () => {
  it('con un solo PC, ese: marcado como este dispositivo y sin campos de más', () => {
    assert.deepEqual(getDevices(fx.ctx), [
      { id: LOCAL, name: 'PC-A', os: 'windows', isThisDevice: true },
    ]);
  });

  it('con otro dispositivo, este PC primero y el otro después', () => {
    asOtherDevice(fx.ctx, { name: 'Portátil' });
    assert.deepEqual(getDevices(fx.ctx), [
      { id: LOCAL, name: 'PC-A', os: 'windows', isThisDevice: true },
      { id: OTHER, name: 'Portátil', os: 'windows', isThisDevice: false },
    ]);
  });

  it('un dispositivo revocado SÍ sale: sus sesiones siguen necesitando nombre', () => {
    asOtherDevice(fx.ctx, { name: 'Portátil' });
    fx.ctx.store.patch('devices', OTHER, { revokedAt: fx.ctx.now() });
    assert.equal(getDevices(fx.ctx).length, 2);
  });

  it('nunca expone la carpeta de usuario ni las versiones', () => {
    asOtherDevice(fx.ctx, { name: 'Portátil', home: 'C:\\Users\\privado' });
    const serialized = JSON.stringify(getDevices(fx.ctx));
    assert.ok(!serialized.includes('privado'));
    assert.ok(!serialized.includes('2.0.0-test'));
  });
});
