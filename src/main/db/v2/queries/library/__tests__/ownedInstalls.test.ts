import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  asOtherDevice,
  openQueryDb,
  seedGame,
  seedInstall,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getOwnedGames } from '../getOwnedGames';

// Lo que la vinculación por escaneo (§11.2) necesita de cada juego: si tiene
// instalación en ESTE PC y en qué carpeta.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const byTitle = (title: string): ReturnType<typeof getOwnedGames>[number] | undefined =>
  getOwnedGames(fx.ctx).find((game) => game.title === title);

describe('getOwnedGames · instalación de este PC', () => {
  it('sin instalación: hasLocalInstall false y carpeta null', () => {
    seedGame(fx.ctx, { title: 'Celeste' });
    const owned = byTitle('Celeste');
    assert.equal(owned?.hasLocalInstall, false);
    assert.equal(owned?.localInstallDirectory, null);
  });

  it('con instalación aquí: true y su carpeta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, { gameId, installDirectory: 'C:\\Games\\Celeste' });
    const owned = byTitle('Celeste');
    assert.equal(owned?.hasLocalInstall, true);
    assert.equal(owned?.localInstallDirectory, 'C:\\Games\\Celeste');
  });

  it('la instalación de OTRO PC no cuenta como local', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx).seedInstall({ gameId, installDirectory: 'D:\\Juegos\\Celeste' });
    const owned = byTitle('Celeste');
    assert.equal(owned?.hasLocalInstall, false);
    assert.equal(owned?.localInstallDirectory, null);
  });

  it('una instalación con lápida tampoco', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const installId = seedInstall(fx.ctx, { gameId });
    fx.ctx.store.remove('game_installs', installId);
    assert.equal(byTitle('Celeste')?.hasLocalInstall, false);
  });

  it('no duplica filas: una por juego aunque haya varias instalaciones', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, { gameId });
    asOtherDevice(fx.ctx).seedInstall({ gameId });
    assert.equal(getOwnedGames(fx.ctx).length, 1);
  });
});
