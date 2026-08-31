import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { cleanupDbs, freshDb, makeEmulator, makeGame, type TestDb } from './harness';

// getWatchTargets es la lista que el watcher barre cada ciclo (~5s) contra
// ps-list. Lo que se blinda no es el shape de cada target (eso lo cambia
// cualquier refactor sin drama), es QUIÉN ENTRA en el barrido — porque
// colarse aquí significa que el watcher le abre una sesión a algo que no
// debía, y quedarse fuera significa que una tarde jugada no se cuenta nunca:
//
//   · un PLANEADO con .exe configurado se queda fuera (planear no es jugar,
//     y Plan to Play vive fuera de Library/Sessions/watcher — TAREAS.md);
//   · un juego sin .exe se queda fuera (nada que vigilar);
//   · un juego EMULADO se queda fuera de la lista de JUEGOS: lo vigilado es
//     el emulador (EMULADORES.md §4 — "este juego no tiene .exe propio que
//     vigilar"), no el juego, aunque el formulario que oculta ese campo sea
//     una guarda de interfaz y la fila de la base pueda llevar los dos datos
//     a la vez (una edición antigua, un dato tocado a mano).

let db: TestDb;
let getWatchTargets: typeof import('../queries/games/getWatchTargets').getWatchTargets;

before(async () => {
  ({ getWatchTargets } = await import('../queries/games/getWatchTargets'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

describe('getWatchTargets: quién entra en el barrido del watcher', () => {
  it('un juego normal con executablePath entra, con su exeName y exePath en minúsculas', async () => {
    await makeGame(db, {
      title: 'Hollow Knight',
      executablePath: 'C:\\Games\\HollowKnight\\HollowKnight.EXE',
    });

    const [target] = await getWatchTargets();

    assert.equal(target.kind, 'game');
    assert.equal(target.key, `game:${target.refId}`);
    assert.equal(target.title, 'Hollow Knight');
    assert.equal(target.exeName, 'hollowknight.exe');
    assert.equal(target.exePath, 'c:\\games\\hollowknight\\hollowknight.exe');
  });

  it('un juego PLANEADO con executablePath queda fuera: planear no es jugar', async () => {
    await makeGame(db, {
      title: 'En el Plan',
      planned: true,
      executablePath: 'C:\\Games\\Plan\\plan.exe',
    });

    assert.deepEqual(await getWatchTargets(), []);
  });

  it('un juego SIN executablePath queda fuera, esté planeado o no', async () => {
    await makeGame(db, { title: 'Sin exe', planned: false, executablePath: null });
    await makeGame(db, { title: 'Sin exe planeado', planned: true, executablePath: null });

    assert.deepEqual(await getWatchTargets(), []);
  });

  it('un juego EMULADO queda fuera de los targets de tipo "game": lo vigilado es el emulador', async () => {
    // El formulario oculta "Executable path" cuando isEmulated está marcado
    // (EMULADORES.md §5), pero esa es una guarda de INTERFAZ, no del schema:
    // nada impide que una fila de la base lleve isEmulated=true con un
    // executablePath colgando (edición antigua, dato migrado, tocado a
    // mano). Si getWatchTargets no filtra por isEmulated, esa fila cuela un
    // segundo watcher sobre el mismo .exe que el emulador ya vigila —dos
    // sesiones abriéndose para la misma tarde jugada, una de tipo 'game' y
    // otra de tipo 'emulator'.
    await makeGame(db, {
      title: 'Chrono Trigger',
      isEmulated: true,
      executablePath: 'C:\\Emu\\RetroArch\\retroarch.exe',
    });

    const targets = await getWatchTargets();
    assert.deepEqual(
      targets.filter((target) => target.kind === 'game'),
      [],
    );
  });

  it('los emuladores registrados SIEMPRE entran, con su propio "kind" y sin mirar la tabla de juegos', async () => {
    const emulatorId = await makeEmulator(db, {
      name: 'RetroArch',
      executablePath: 'C:\\Emu\\RetroArch\\RetroArch.exe',
    });

    const [target] = await getWatchTargets();

    assert.equal(target.kind, 'emulator');
    assert.equal(target.key, `emu:${emulatorId}`);
    assert.equal(target.refId, emulatorId);
    assert.equal(target.exeName, 'retroarch.exe');
  });

  it('juegos y emuladores conviven en la misma lista sin pisarse las claves', async () => {
    const gameId = await makeGame(db, {
      title: 'Celeste',
      executablePath: 'C:\\Games\\Celeste\\Celeste.exe',
    });
    const emulatorId = await makeEmulator(db);

    const targets = await getWatchTargets();

    assert.deepEqual(
      targets.map((target) => target.key).sort(),
      [`emu:${emulatorId}`, `game:${gameId}`].sort(),
    );
  });
});
