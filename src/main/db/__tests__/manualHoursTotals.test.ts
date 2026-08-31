import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// LAS HORAS TECLEADAS ("ya le había echado 50 h en la otra máquina") VISTAS
// DESDE LAS DOS PANTALLAS QUE LAS ENSEÑABAN MAL.
//
// Las dos consultas de aquí no comparten una línea de código, pero comparten
// el mismo agujero: cada una se inventó su propia versión de una regla que ya
// estaba escrita en shared/ y en games/iterationHours.ts, y por eso el mismo
// juego decía tres cifras distintas según dónde lo miraras.
//
// Contra base real (ver harness.ts) porque lo que se está probando es
// justamente el CABLEADO: las dos reglas ya tenían su test unitario verde
// mientras la app no les pasaba el dato.
//
// Para lanzarlo solo:
//   npx tsx --test --experimental-test-module-mocks src/main/db/__tests__/manualHoursTotals.test.ts

let db: TestDb;
let getMemoryFacts: typeof import('../queries/memories/getMemoryFacts').getMemoryFacts;
let getSessionClosedInfo: typeof import('../queries/sessions/getSessionClosedInfo').getSessionClosedInfo;

// Los módulos bajo prueba se importan DENTRO del before(): el mock.module del
// andamio tiene que estar registrado antes de que resuelvan su getDb.
before(async () => {
  ({ getMemoryFacts } = await import('../queries/memories/getMemoryFacts'));
  ({ getSessionClosedInfo } = await import('../queries/sessions/getSessionClosedInfo'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

describe('el Loop fecha las horas manuales con la misma pista que Stats', () => {
  it('sin log de estados, el ancla es la PRIMERA sesión del playthrough', async () => {
    // El agujero más corriente que hay: un juego que el watcher detectó solo
    // —sesiones sí, log de estados no— al que le tecleas las horas de la otra
    // máquina. getGames ya le colgaba el año de su primera sesión; aquí el
    // ancla salía null, y chapters.ts descarta los bloques sin ancla: esas 50
    // horas no entraban en ningún recap ni abrían mes mientras Stats las
    // fechaba. La misma hora no puede ser de 2025 en una pantalla y de ningún
    // sitio en la de al lado.
    const juego = await makeGame(db, { title: 'Detectado por el watcher' });
    const iteracion = await makeIteration(db, juego, { manualTotalPlayed: 50 });
    await makeSession(db, iteracion, '2025-05-10T20:00:00', 2);
    await makeSession(db, iteracion, '2025-03-02T18:00:00', 1);

    const facts = await getMemoryFacts();
    assert.deepEqual(facts.manualBlocks, [
      { gameId: juego, hours: 50, anchor: new Date('2025-03-02T18:00:00') },
    ]);
  });

  it('el log manda mientras diga algo: con un final tecleado, la sesión no pinta nada', async () => {
    // El orden de las tres pistas no lo decide esta consulta, lo decide
    // manualHoursAnchor. Si esto cayera, el arreglo habría colado la sesión
    // por delante del "me lo pasé en enero" que escribió el usuario.
    const juego = await makeGame(db, { title: 'Terminado en enero' });
    const iteracion = await makeIteration(db, juego, { manualTotalPlayed: 30 });
    await makeSession(db, iteracion, '2026-04-01T12:00:00', 3);
    await makeStateEvent(db, iteracion, 'completed', '2026-01-20T18:00:00');

    const facts = await getMemoryFacts();
    assert.deepEqual(facts.manualBlocks, [
      { gameId: juego, hours: 30, anchor: new Date('2026-01-20T18:00:00') },
    ]);
  });
});

describe('el aviso de cierre da el total del juego con la regla de la casa', () => {
  it('suma las horas manuales a lo medido, como la card y la ficha', async () => {
    // El toast decía "3h total" de un juego que en su card ponía 53h: sumaba
    // durationSec y se saltaba manualTotalPlayed, o sea la mitad del total que
    // resolveIterationHours lleva definiendo desde SPEC-2 §4.4.
    const juego = await makeGame(db, { title: 'Cincuenta de la otra máquina' });
    const iteracion = await makeIteration(db, juego, { manualTotalPlayed: 50 });
    const sesion = await makeSession(db, iteracion, '2026-08-01T20:00:00', 3);

    const info = await getSessionClosedInfo(sesion);
    assert.ok(info);
    assert.equal(info.totalHours, 53);
    assert.equal(info.durationSec, 3 * 3600);
  });

  it('cuenta los playthroughs del juego que no tienen ni una sesión medida', async () => {
    // El playthrough de horas tecleadas y cero partidas no aparece en el join
    // por sesiones: si el total se calculara desde ahí, esas 20 h no existirían
    // para el toast aunque la ficha las enseñe.
    const juego = await makeGame(db, { title: 'Dos vueltas' });
    const viejo = await makeIteration(db, juego, {
      label: 'Playthrough 1',
      manualTotalPlayed: 20,
    });
    assert.ok(viejo);
    const actual = await makeIteration(db, juego, { label: 'Playthrough 2' });
    const sesion = await makeSession(db, actual, '2026-08-02T20:00:00', 1.5);

    const info = await getSessionClosedInfo(sesion);
    assert.ok(info);
    assert.equal(info.totalHours, 21.5);
  });
});
