import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  OTHER,
  asOtherDevice,
  openQueryDb,
  seedGame,
  seedInstall,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { getLocalInstall } from '../../db/v2/queries/library';
import type { ScannedFolder } from '../contracts';
import { isExactLibraryTitle } from '../folderTitle';
import { decideLink, linkInstall, type LinkableGame } from '../linkInstalls';

// VINCULACIÓN POR ESCANEO (§11.2): cuándo una carpeta escaneada se enlaza a un
// juego que ya está en la biblioteca, y qué se escribe.

const game = (overrides: Partial<LinkableGame> & { title: string }): LinkableGame => ({
  id: `id-${overrides.title}`,
  igdbId: null,
  hasLocalInstall: false,
  localInstallDirectory: null,
  ...overrides,
});

const folder = (overrides: Partial<ScannedFolder> = {}): ScannedFolder => ({
  folderName: 'Celeste',
  path: 'D:\\Games\\Celeste',
  root: 'Games',
  sizeBytes: 1234,
  executablePath: 'D:\\Games\\Celeste\\Celeste.exe',
  executableCandidates: ['D:\\Games\\Celeste\\Celeste.exe'],
  ...overrides,
});

describe('isExactLibraryTitle', () => {
  it('mismo título tras limpiar edición y ruido', () => {
    assert.equal(isExactLibraryTitle(['Celeste'], 'Celeste'), true);
    assert.equal(isExactLibraryTitle(['CELESTE'], 'Celeste'), true);
  });

  it('"Portal 2" no es "Portal": parecerse mucho no basta', () => {
    assert.equal(isExactLibraryTitle(['Portal 2'], 'Portal'), false);
    assert.equal(isExactLibraryTitle(['Portal'], 'Portal 2'), false);
  });

  it('un título vacío nunca coincide', () => {
    assert.equal(isExactLibraryTitle(['Celeste'], ''), false);
  });
});

describe('decideLink', () => {
  it('un juego de la biblioteca sin instalación aquí y con ejecutable: link', () => {
    const celeste = game({ title: 'Celeste' });
    assert.deepEqual(decideLink(folder(), ['Celeste'], null, [celeste]), {
      action: 'link',
      game: celeste,
    });
  });

  it('por ficha de IGDB aunque el título no sea el mismo', () => {
    const celeste = game({ title: 'Celeste', igdbId: 7 });
    assert.equal(decideLink(folder(), ['Otro nombre'], 7, [celeste]).action, 'link');
  });

  it('sin ejecutable defendible no se escribe nada', () => {
    const celeste = game({ title: 'Celeste' });
    assert.equal(
      decideLink(folder({ executablePath: null }), ['Celeste'], null, [celeste]).action,
      'none',
    );
  });

  it('si ya tiene instalación aquí, no se toca', () => {
    const celeste = game({
      title: 'Celeste',
      hasLocalInstall: true,
      localInstallDirectory: 'C:\\Otra\\Celeste',
    });
    assert.equal(decideLink(folder(), ['Celeste'], null, [celeste]).action, 'none');
  });

  it('ya vinculado a ESTA carpeta (otro escaneo): linked, sin barras ni mayúsculas', () => {
    const celeste = game({
      title: 'Celeste',
      hasLocalInstall: true,
      localInstallDirectory: 'd:/games/celeste/',
    });
    assert.deepEqual(decideLink(folder(), ['Celeste'], null, [celeste]), {
      action: 'linked',
      game: celeste,
    });
  });

  it('un nombre parecido pero no igual no vincula', () => {
    assert.equal(
      decideLink(folder({ folderName: 'Portal 2' }), ['Portal 2'], null, [
        game({ title: 'Portal' }),
      ]).action,
      'none',
    );
  });

  it('varios del mismo nombre y alguno ya instalado aquí: no se adivina', () => {
    const library = [
      game({ title: 'Celeste', id: 'a', hasLocalInstall: true, localInstallDirectory: 'C:\\x' }),
      game({ title: 'Celeste', id: 'b' }),
    ];
    assert.equal(decideLink(folder(), ['Celeste'], null, library).action, 'none');
  });

  it('varios del mismo nombre y ninguno instalado: tampoco se adivina', () => {
    const library = [game({ title: 'Celeste', id: 'a' }), game({ title: 'Celeste', id: 'b' })];
    assert.equal(decideLink(folder(), ['Celeste'], null, library).action, 'none');
  });

  it('varios del mismo nombre: la ficha de IGDB decide si señala a uno solo', () => {
    const library = [
      game({ title: 'Celeste', id: 'a', igdbId: 1 }),
      game({ title: 'Celeste', id: 'b', igdbId: 2 }),
    ];
    const decision = decideLink(folder(), ['Celeste'], 2, library);
    assert.equal(decision.action, 'link');
    assert.equal(decision.action === 'link' ? decision.game.id : null, 'b');
  });

  it('nada en la biblioteca con ese nombre: none', () => {
    assert.equal(decideLink(folder(), ['Celeste'], null, []).action, 'none');
  });
});

describe('linkInstall', () => {
  let fx: QueryFixture;
  beforeEach(() => {
    fx = openQueryDb();
  });
  afterEach(() => fx.close());

  it('crea SOLO la instalación de este PC y no toca las de otros', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx).seedInstall({ gameId, executablePath: 'E:\\Juegos\\Celeste.exe' });

    const linkable = game({ title: 'Celeste', id: gameId });
    assert.equal(linkInstall(fx.ctx, linkable, folder()), true);

    assert.deepEqual(getLocalInstall(fx.ctx, gameId), {
      executablePath: 'D:\\Games\\Celeste\\Celeste.exe',
      installDirectory: 'D:\\Games\\Celeste',
    });
    const rows = fx.ctx.db.$client
      .prepare('SELECT deviceId, executablePath FROM game_installs WHERE gameId = ?')
      .all(gameId) as { deviceId: string; executablePath: string }[];
    assert.equal(rows.length, 2);
    assert.equal(
      rows.find((row) => row.deviceId === OTHER)?.executablePath,
      'E:\\Juegos\\Celeste.exe',
    );
  });

  it('sin ejecutable devuelve false y no escribe', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const linkable = game({ title: 'Celeste', id: gameId });
    assert.equal(linkInstall(fx.ctx, linkable, folder({ executablePath: null })), false);
    assert.equal(getLocalInstall(fx.ctx, gameId), null);
  });

  it('un juego borrado entre la lectura y la escritura devuelve false', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, { gameId });
    fx.ctx.store.remove('games', gameId);
    assert.equal(linkInstall(fx.ctx, game({ title: 'Celeste', id: gameId }), folder()), false);
  });
});
