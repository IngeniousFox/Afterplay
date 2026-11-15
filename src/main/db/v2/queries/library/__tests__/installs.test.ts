import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  OTHER,
  asOtherDevice,
  openQueryDb,
  seedGame,
  seedInstall,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getInstalledOn, getLocalInstall } from '../installs';

// Las instalaciones de un juego (§11.4): la ruta de ESTE PC (que solo resuelve
// el main para lanzar) y en qué dispositivos está instalado, sin rutas.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getLocalInstall', () => {
  it('null si el juego no está instalado en este PC', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(getLocalInstall(fx.ctx, gameId), null);
  });

  it('la ruta y la carpeta de la instalación de este PC', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, {
      gameId,
      executablePath: 'C:\\Games\\Celeste\\Celeste.exe',
      installDirectory: 'C:\\Games\\Celeste',
    });
    assert.deepEqual(getLocalInstall(fx.ctx, gameId), {
      executablePath: 'C:\\Games\\Celeste\\Celeste.exe',
      installDirectory: 'C:\\Games\\Celeste',
    });
  });

  it('la instalación de OTRO PC no cuenta como instalado aquí (nunca se lanza su ruta)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx).seedInstall({ gameId, executablePath: 'D:\\Juegos\\Celeste.exe' });
    assert.equal(getLocalInstall(fx.ctx, gameId), null);
  });

  it('una instalación con lápida no cuenta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const installId = seedInstall(fx.ctx, { gameId });
    fx.ctx.store.remove('game_installs', installId);
    assert.equal(getLocalInstall(fx.ctx, gameId), null);
  });

  it('un juego borrado ya no tiene instalación (F-11)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, { gameId });
    fx.ctx.store.remove('games', gameId);
    assert.equal(getLocalInstall(fx.ctx, gameId), null);
  });
});

describe('getInstalledOn', () => {
  it('sin instalaciones, vacío', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.deepEqual(getInstalledOn(fx.ctx, gameId), []);
  });

  it('este PC primero y los demás después, con nombre y sin ninguna ruta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx, { name: 'Portátil' });
    other.seedInstall({ gameId, executablePath: 'D:\\Secreto\\Celeste.exe' });
    seedInstall(fx.ctx, { gameId, executablePath: 'C:\\Games\\Celeste.exe' });

    const installedOn = getInstalledOn(fx.ctx, gameId);
    assert.deepEqual(installedOn, [
      { deviceId: fx.ctx.deviceId, deviceName: 'PC-A', isThisDevice: true },
      { deviceId: OTHER, deviceName: 'Portátil', isThisDevice: false },
    ]);
    const serialized = JSON.stringify(installedOn);
    assert.ok(!serialized.includes('Secreto'), 'la ruta de otro PC no sale del main');
    assert.ok(!serialized.includes('Games'));
  });

  it('solo en otro PC: no está instalado aquí pero sí allí', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx, { name: 'Portátil' }).seedInstall({ gameId });
    assert.deepEqual(getInstalledOn(fx.ctx, gameId), [
      { deviceId: OTHER, deviceName: 'Portátil', isThisDevice: false },
    ]);
  });

  it('una instalación con lápida o sin ruta ni carpeta no cuenta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const removed = seedInstall(fx.ctx, { gameId });
    fx.ctx.store.remove('game_installs', removed);
    asOtherDevice(fx.ctx).seedInstall({
      gameId,
      executablePath: null,
      installDirectory: null,
    });
    assert.deepEqual(getInstalledOn(fx.ctx, gameId), []);
  });
});
