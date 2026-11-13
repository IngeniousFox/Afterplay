import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count } from '../../../__tests__/helpers';
import {
  asOtherDevice,
  openQueryDb,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { createEmulator, deleteEmulator, getEmulators } from '../emulators';
import { getWatchTargets } from '../watchTargets';
import { sessionRow } from './helpers';

// Emuladores e instalaciones (§3.3) y los objetivos del watcher (§11.1).
// `getWatchTargets` porta `src/main/db/__tests__/getWatchTargets.test.ts` y
// añade lo nuevo: solo las instalaciones de ESTE dispositivo.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('emuladores', () => {
  it('createEmulator escribe el emulador y su instalación en este PC, y getEmulators los lee', () => {
    const created = createEmulator(fx.ctx, {
      name: 'RetroArch',
      executablePath: 'C:\\Emu\\RetroArch\\retroarch.exe',
    });

    assert.deepEqual(getEmulators(fx.ctx), [created]);
    assert.equal(created.executablePath, 'C:\\Emu\\RetroArch\\retroarch.exe');
    assert.equal(count(fx.local, 'emulator_installs', `deviceId = '${fx.ctx.deviceId}'`), 1);
  });

  it('getEmulators: por nombre sin mayúsculas, con la ruta de ESTE PC', () => {
    const b = seedEmulator(fx.ctx, { name: 'dolphin', executablePath: 'C:\\Emu\\dolphin.exe' });
    const a = seedEmulator(fx.ctx, { name: 'DuckStation', executablePath: null });
    asOtherDevice(fx.ctx).seedEmulatorInstall({ emulatorId: a, executablePath: 'D:\\otro.exe' });

    const rows = getEmulators(fx.ctx);

    assert.deepEqual(
      rows.map((r) => [r.id, r.executablePath]),
      [
        [b, 'C:\\Emu\\dolphin.exe'],
        // Sin instalación aquí: '' (R-08). La ruta del otro PC no sirve.
        [a, ''],
      ],
    );
  });

  it('deleteEmulator: lápida al emulador, sus instalaciones y sus pendientes; las asignadas se quedan', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const pending = seedSession(fx.ctx, { emulatorId });
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    const assigned = seedSession(fx.ctx, {
      playthroughId: seedPlaythrough(fx.ctx, { gameId }),
      emulatorId,
    });

    assert.equal(deleteEmulator(fx.ctx, emulatorId), true);

    assert.deepEqual(getEmulators(fx.ctx), []);
    assert.notEqual(sessionRow(fx.ctx, pending)?.syncDeleted, null);
    assert.equal(sessionRow(fx.ctx, assigned)?.syncDeleted, null);
    assert.equal(sessionRow(fx.ctx, assigned)?.emulatorId, emulatorId);
    assert.equal(deleteEmulator(fx.ctx, emulatorId), false);
    assert.equal(deleteEmulator(fx.ctx, 'no-existe'), false);
  });
});

describe('getWatchTargets: quién entra en el barrido del watcher', () => {
  it('un juego con ejecutable en este PC entra, con exeName y exePath en minúsculas', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Hollow Knight',
      install: { executablePath: 'C:\\Games\\HollowKnight\\HollowKnight.EXE' },
    });

    const [target] = getWatchTargets(fx.ctx);

    assert.equal(target.kind, 'game');
    assert.equal(target.refId, gameId);
    assert.equal(target.key, `game:${gameId}`);
    assert.equal(target.title, 'Hollow Knight');
    assert.equal(target.exeName, 'hollowknight.exe');
    assert.equal(target.exePath, 'c:\\games\\hollowknight\\hollowknight.exe');
  });

  it('un juego PLANEADO queda fuera; promocionado (plan con lápida) vuelve a entrar', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'En el Plan',
      planned: true,
      install: { executablePath: 'C:\\Games\\Plan\\plan.exe' },
    });
    assert.deepEqual(getWatchTargets(fx.ctx), []);

    fx.ctx.store.remove('plan_entries', gameId);
    assert.equal(getWatchTargets(fx.ctx).length, 1);
  });

  it('sin ejecutable, o sin instalación en este PC, queda fuera', () => {
    seedGame(fx.ctx, { title: 'Sin exe', install: { executablePath: null } });
    seedGame(fx.ctx, { title: 'Sin instalación' });
    const elsewhere = seedGame(fx.ctx, { title: 'Solo en el otro PC' });
    asOtherDevice(fx.ctx).seedInstall({ gameId: elsewhere });

    assert.deepEqual(getWatchTargets(fx.ctx), []);
  });

  it('un juego EMULADO no entra como "game": lo vigilado es el emulador', () => {
    seedGame(fx.ctx, {
      title: 'Chrono Trigger',
      isEmulated: true,
      install: { executablePath: 'C:\\Emu\\RetroArch\\retroarch.exe' },
    });
    assert.deepEqual(
      getWatchTargets(fx.ctx).filter((t) => t.kind === 'game'),
      [],
    );
  });

  it('un juego borrado no se vigila', () => {
    const gameId = seedGame(fx.ctx, { title: 'Borrado', install: {} });
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(getWatchTargets(fx.ctx), []);
  });

  it('los emuladores con ruta en este PC entran con su propio kind; sin ruta aquí, no', () => {
    const emulatorId = seedEmulator(fx.ctx, {
      name: 'RetroArch',
      executablePath: 'C:\\Emu\\RetroArch\\RetroArch.exe',
    });
    const elsewhere = seedEmulator(fx.ctx, { name: 'Dolphin', executablePath: null });
    asOtherDevice(fx.ctx).seedEmulatorInstall({ emulatorId: elsewhere });

    const targets = getWatchTargets(fx.ctx);

    assert.equal(targets.length, 1);
    assert.equal(targets[0].kind, 'emulator');
    assert.equal(targets[0].key, `emu:${emulatorId}`);
    assert.equal(targets[0].refId, emulatorId);
    assert.equal(targets[0].exeName, 'retroarch.exe');
  });

  it('juegos y emuladores conviven sin pisarse las claves', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Celeste',
      install: { executablePath: 'C:\\Games\\Celeste\\Celeste.exe' },
    });
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });

    assert.deepEqual(
      getWatchTargets(fx.ctx)
        .map((t) => t.key)
        .sort(),
      [`emu:${emulatorId}`, `game:${gameId}`].sort(),
    );
  });
});
