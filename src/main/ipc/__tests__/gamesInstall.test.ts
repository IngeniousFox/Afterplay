import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { closeAppDbFixture, freshAppDb } from '../../db/v2/__tests__/appDbHarness';
import {
  asOtherDevice,
  seedGame,
  seedInstall,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import type { GameInstallInfo } from '../../../shared/devices';
import type { LaunchExecutableResult } from '../../../shared/types';

// LANZAR Y COMPROBAR POR gameId (§11.3, §11.4).
//
// El renderer ya no manda rutas: manda el id del juego y el main resuelve la
// instalación de ESTE dispositivo. Lo que se blinda aquí es el handler de
// verdad: qué ruta llega a abrirse, que la de otro PC nunca se lance, que
// comprobar el ejecutable no escriba nada en la base.
//
// REAL: games.ts, las consultas y la base 2.0 en memoria. DOBLADO: electron, el
// registro del IPC, la apertura de rutas (se captura la ruta) y los módulos de
// red/colas que games.ts arrastra.

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const opened: string[] = [];

mock.module('electron', {
  namedExports: {
    ipcMain: { handle: (): void => {} },
    shell: { openPath: async (): Promise<string> => '' },
  },
});
mock.module('../contractHandlers', {
  namedExports: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
  },
});
mock.module('../../steam/backfill', {
  namedExports: { queueAchievementsRefreshForGame: async (): Promise<boolean> => true },
});
mock.module('../../external/warmNewGame', {
  namedExports: { warmImageCache: (): void => {}, warmSteamData: (): void => {} },
});
mock.module('../../curiosities/backfill', {
  namedExports: { generateCuriositiesInBackground: (): void => {} },
});
mock.module('../../steam/notify', {
  namedExports: { notifyAchievementsActivity: (): void => {} },
});
mock.module('../../lib/openPath', {
  namedExports: {
    openPathResult: async (path: string): Promise<{ ok: true }> => {
      opened.push(path);
      return { ok: true };
    },
  },
});

let fx: QueryFixture;
let launch: (gameId: string) => Promise<LaunchExecutableResult>;
let openDirectory: (gameId: string) => Promise<LaunchExecutableResult>;
let installInfo: (gameId: string) => Promise<GameInstallInfo>;
// Un ejecutable que existe de verdad (el de node) y uno que no: no hace falta
// crear ficheros para comprobar el disco.
const PRESENT_EXECUTABLE = process.execPath;
const MISSING_EXECUTABLE = join(dirname(process.execPath), 'afterplay-no-existe.exe');

before(async () => {
  const { registerGamesHandlers } = await import('../games');
  registerGamesHandlers();
  const call =
    <T>(channel: string) =>
    (gameId: string): Promise<T> => {
      const handler = handlers.get(channel);
      assert.ok(handler, `${channel} debería estar registrado`);
      return handler({}, gameId) as Promise<T>;
    };
  launch = call<LaunchExecutableResult>('games:launchExecutable');
  openDirectory = call<LaunchExecutableResult>('games:openInstallDirectory');
  installInfo = call<GameInstallInfo>('games:getInstallInfo');
});

beforeEach(() => {
  fx = freshAppDb();
  opened.length = 0;
});

after(closeAppDbFixture);

describe('games:launchExecutable / games:openInstallDirectory', () => {
  it('abre el ejecutable y la carpeta de la instalación de ESTE PC', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, {
      gameId,
      executablePath: 'C:\\Games\\Celeste\\Celeste.exe',
      installDirectory: 'C:\\Games\\Celeste',
    });
    assert.deepEqual(await launch(gameId), { ok: true });
    assert.deepEqual(await openDirectory(gameId), { ok: true });
    assert.deepEqual(opened, ['C:\\Games\\Celeste\\Celeste.exe', 'C:\\Games\\Celeste']);
  });

  it('sin instalación aquí: not_installed y no se abre nada', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.deepEqual(await launch(gameId), { ok: false, reason: 'not_installed' });
    assert.deepEqual(await openDirectory(gameId), { ok: false, reason: 'not_installed' });
    assert.deepEqual(opened, []);
  });

  it('la ruta de OTRO PC no se lanza nunca', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx).seedInstall({
      gameId,
      executablePath: 'D:\\Juegos\\Celeste.exe',
      installDirectory: 'D:\\Juegos',
    });
    assert.deepEqual(await launch(gameId), { ok: false, reason: 'not_installed' });
    assert.deepEqual(await openDirectory(gameId), { ok: false, reason: 'not_installed' });
    assert.deepEqual(opened, []);
  });

  it('un id que no existe tampoco abre nada', async () => {
    assert.deepEqual(await launch('no-existe'), { ok: false, reason: 'not_installed' });
    assert.deepEqual(opened, []);
  });
});

describe('games:getInstallInfo', () => {
  it('ejecutable presente: present, y dónde está instalado', async () => {
    const executablePath = PRESENT_EXECUTABLE;
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedInstall(fx.ctx, { gameId, executablePath, installDirectory: dirname(executablePath) });
    const info = await installInfo(gameId);
    assert.equal(info.executable, 'present');
    assert.deepEqual(
      info.installedOn.map((entry) => [entry.deviceName, entry.isThisDevice]),
      [['PC-A', true]],
    );
  });

  it('ejecutable que ya no está en la ruta: missing, SIN tocar la instalación', async () => {
    const executablePath = MISSING_EXECUTABLE;
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const installId = seedInstall(fx.ctx, { gameId, executablePath });
    const snapshot = (): unknown =>
      fx.ctx.db.$client.prepare('SELECT * FROM game_installs WHERE id = ?').get(installId);
    const before = snapshot();

    const info = await installInfo(gameId);
    assert.equal(info.executable, 'missing');

    // Comprobar no escribe: la fila (con sus versiones de sync) queda idéntica y
    // viva, y lanzar sigue intentando esa ruta (§11.3).
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(await launch(gameId), { ok: true });
    assert.equal(opened[0], executablePath);
  });

  it('sin instalación aquí: none, aunque esté instalado en otro PC', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    asOtherDevice(fx.ctx, { name: 'Portátil' }).seedInstall({ gameId });
    const info = await installInfo(gameId);
    assert.equal(info.executable, 'none');
    assert.deepEqual(
      info.installedOn.map((entry) => [entry.deviceName, entry.isThisDevice]),
      [['Portátil', false]],
    );
  });
});
