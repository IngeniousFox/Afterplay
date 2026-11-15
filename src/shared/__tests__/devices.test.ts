import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  UNKNOWN_DEVICE_NAME,
  deviceNameFor,
  hasSeveralDevices,
  shouldShowInstalledOn,
  type DeviceInfo,
  type InstalledOn,
} from '../devices';

const device = (id: string, name: string, isThisDevice = false): DeviceInfo => ({
  id,
  name,
  os: 'windows',
  isThisDevice,
});
const install = (deviceId: string, isThisDevice: boolean): InstalledOn => ({
  deviceId,
  deviceName: deviceId,
  isThisDevice,
});

describe('deviceNameFor', () => {
  it('el nombre del dispositivo, o "another PC" si no se conoce o está vacío', () => {
    const devices = [device('a', 'PC-A', true), device('b', '  ')];
    assert.equal(deviceNameFor(devices, 'a'), 'PC-A');
    assert.equal(deviceNameFor(devices, 'b'), UNKNOWN_DEVICE_NAME);
    assert.equal(deviceNameFor(devices, 'zzz'), 'another PC');
    assert.equal(deviceNameFor([], 'a'), 'another PC');
  });
});

describe('hasSeveralDevices', () => {
  it('solo con más de uno', () => {
    assert.equal(hasSeveralDevices([]), false);
    assert.equal(hasSeveralDevices([device('a', 'PC-A', true)]), false);
    assert.equal(hasSeveralDevices([device('a', 'PC-A', true), device('b', 'PC-B')]), true);
  });
});

describe('shouldShowInstalledOn', () => {
  it('sin instalaciones, nunca', () => {
    assert.equal(shouldShowInstalledOn([], 3), false);
  });

  it('con un solo dispositivo conocido y el juego instalado aquí, es ruido', () => {
    assert.equal(shouldShowInstalledOn([install('a', true)], 1), false);
  });

  it('con más de un dispositivo conocido, se enseña', () => {
    assert.equal(shouldShowInstalledOn([install('a', true)], 2), true);
    assert.equal(shouldShowInstalledOn([install('a', true), install('b', false)], 2), true);
  });

  it('si no está instalado aquí pero sí en otro, se enseña aunque solo conozcamos uno', () => {
    assert.equal(shouldShowInstalledOn([install('b', false)], 1), true);
  });
});
