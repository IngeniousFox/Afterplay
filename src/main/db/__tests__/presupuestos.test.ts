import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  makeIteration,
  makeSession,
  makeStateEvent,
  makeUnlock,
  measure,
  type TestDb,
} from './harness';

// PRESUPUESTOS DE TRABAJO — la red contra las regresiones de rendimiento.
//
// Estos tests NO cronometran. Un assert sobre milisegundos falla en una
// máquina cargada, y lo que pasa entonces es que alguien sube el número hasta
// que deja de significar nada: un test que enseña a ignorar la suite. Lo que
// se cuenta aquí es determinista y da igual en qué máquina corras:
//
//   · CONSULTAS — cuántas veces se va a la base. Es el detector de N+1: la
//     regresión clásica es meter un `await` dentro de un `for` y pasar de una
//     consulta a una por juego, que en una biblioteca de 994 no se nota en
//     desarrollo con cuatro filas de prueba y sí en la de verdad.
//   · FILAS — cuántas cruzan el driver hacia JavaScript. Esto es lo que de
//     verdad cuesta en esta app, medido sobre la biblioteca real: traerse las
//     39.808 definiciones de logros son ~260 ms, y el MISMO dato agregado en
//     SQL son 40. La diferencia no está en el SQL, está en el viaje.
//
// LOS NÚMEROS NO SON OBJETIVOS, SON FOTOS. Cada presupuesto está por encima
// de lo que la consulta gasta hoy, con el margen justo para que un cambio
// honesto no lo rompa y uno que degrada sí. Si tocas una consulta y este test
// se pone rojo, la pregunta no es "¿subo el número?" sino "¿por qué mi cambio
// se lleva más filas?". Si la respuesta es buena, se sube el número Y se
// explica aquí por qué.
//
// Y cada presupuesto va con su aserción de RESULTADO al lado, a propósito:
// una consulta puede volverse muy barata devolviendo mal el dato, y un test
// de rendimiento que no mira lo que sale premia justo eso.

let db: TestDb;
let getGames: typeof import('../queries/games/getGames').getGames;
let getGameById: typeof import('../queries/games/getGameById').getGameById;
let getAllSessions: typeof import('../queries/sessions/getAllSessions').getAllSessions;
let getPlannedGames: typeof import('../queries/games/getPlannedGames').getPlannedGames;
let getSessionUnlocks: typeof import('../queries/achievements/getSessionUnlocks').getSessionUnlocks;

before(async () => {
  ({ getGames } = await import('../queries/games/getGames'));
  ({ getGameById } = await import('../queries/games/getGameById'));
  ({ getAllSessions } = await import('../queries/sessions/getAllSessions'));
  ({ getPlannedGames } = await import('../queries/games/getPlannedGames'));
  ({ getSessionUnlocks } = await import('../queries/achievements/getSessionUnlocks'));
});

beforeEach(async () => {
  db = await freshDb();
});

after(() => cleanupDbs());

// Una biblioteca pequeña pero con TODAS las formas que la app produce, para
// que los conteos no dependan de un caso degenerado: juegos con y sin
// sesiones, planeados, un playthrough terminado y otro en marcha, y logros
// con sus desbloqueos.
const sembrarBiblioteca = async (juegos: number): Promise<number[]> => {
  const ids: number[] = [];
  for (let i = 0; i < juegos; i++) {
    const gameId = await makeGame(db, { title: `Juego ${String(i).padStart(3, '0')}` });
    ids.push(gameId);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-05T18:00:00Z');
    await makeSession(db, iterationId, '2026-01-05T18:00:00Z', 2);
    await makeSession(db, iterationId, '2026-01-06T18:00:00Z', 1.5);
    if (i % 3 === 0) await makeStateEvent(db, iterationId, 'completed', '2026-02-01T20:00:00Z');
  }
  return ids;
};

describe('presupuestos: la lista de la biblioteca', () => {
  it('getGames no hace una consulta por juego, pase lo que pase con el tamaño', async () => {
    // EL N+1 QUE ESTA CONSULTA EVITA A PROPÓSITO: horas, nº de sesiones,
    // estado y "última jugada" salen de agregar en JS unas pocas consultas
    // grandes, no de preguntar por cada juego. La cabecera de getGames.ts lo
    // dice ("nada de JOIN plano ni ROW_NUMBER"), y esto es lo que impide que
    // se pierda: el conteo tiene que ser el MISMO con 5 juegos que con 25.
    await sembrarBiblioteca(5);
    const [pocos, gastoPocos] = await measure(() => getGames());

    db = await freshDb();
    await sembrarBiblioteca(25);
    const [muchos, gastoMuchos] = await measure(() => getGames());

    assert.equal(pocos.length, 5);
    assert.equal(muchos.length, 25);
    assert.equal(
      gastoPocos.queries,
      gastoMuchos.queries,
      'getGames hace más consultas cuando hay más juegos: hay un N+1 nuevo',
    );
    assert.ok(
      gastoMuchos.queries <= 3,
      `getGames deberia resolverse en 3 consultas y ha hecho ${gastoMuchos.queries}`,
    );
  });

  it('getGames no se trae mas filas que las que hay que agregar', async () => {
    // Juegos + iteraciones con sesiones agregadas + eventos de estado: 34
    // filas para estos 10 juegos. El presupuesto corta que se vuelvan a
    // transportar los agregados de sesiones por separado o que
    // alguien añada una tabla entera más al viaje (los logros, las curiosidades)
    // sin darse cuenta de que esta consulta corre en CADA 'games:changed', o
    // sea cada vez que el watcher abre o cierra una sesión.
    await sembrarBiblioteca(10);
    const [lista, gasto] = await measure(() => getGames());

    assert.equal(lista.length, 10);
    assert.ok(
      gasto.rows <= 40,
      `getGames se ha traido ${gasto.rows} filas para 10 juegos; el presupuesto son 40`,
    );
  });
});

describe('presupuestos: la ficha de un juego', () => {
  it('getGameById cuesta lo mismo con un playthrough que con seis', async () => {
    // La ficha es lo que más se abre, y su coste tiene que depender del JUEGO,
    // no de cuántas veces lo hayas rejugado. Un `await` por playthrough aquí
    // sería invisible con uno y notorio con el sexto.
    const gameId = await makeGame(db, { title: 'Rejugado' });
    const primera = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeSession(db, primera, '2026-01-05T18:00:00Z', 2);
    const [uno, gastoUno] = await measure(() => getGameById(gameId));

    for (let i = 2; i <= 6; i++) {
      const otra = await makeIteration(db, gameId, { label: `Playthrough ${i}` });
      await makeSession(db, otra, `2026-0${i}-05T18:00:00Z`, 1);
    }
    const [seis, gastoSeis] = await measure(() => getGameById(gameId));

    assert.equal(uno?.iterations.length, 1);
    assert.equal(seis?.iterations.length, 6);
    assert.equal(
      gastoUno.queries,
      gastoSeis.queries,
      'getGameById hace más consultas cuantos más playthroughs: hay un N+1 nuevo',
    );
  });

  it('la ficha no se trae los logros de TODA la biblioteca', async () => {
    // El caso que hace daño de verdad: 39.808 filas en `achievements` en una
    // biblioteca real. Abrir la ficha de un juego con 3 logros no puede costar
    // lo mismo que abrir la de cualquier otro — y si alguien quita el WHERE por
    // gameId, eso es exactamente lo que pasa, sin que se note en desarrollo.
    const conLogros = await makeGame(db, { title: 'Con logros' });
    const iterationId = await makeIteration(db, conLogros);
    await makeSession(db, iterationId, '2026-01-05T18:00:00Z', 2);
    for (let i = 0; i < 3; i++) await makeAchievement(db, conLogros, `mios_${i}`);

    const otro = await makeGame(db, { title: 'Otro juego' });
    for (let i = 0; i < 200; i++) await makeAchievement(db, otro, `ajenos_${i}`);

    const [ficha, gasto] = await measure(() => getGameById(conLogros));

    assert.equal(ficha?.title, 'Con logros');
    assert.ok(
      gasto.rows < 20,
      `la ficha se ha traido ${gasto.rows} filas teniendo 203 logros en la base (hoy son 3): se esta llevando los ajenos`,
    );
  });
});

describe('presupuestos: las vistas que agregan', () => {
  it('getAllSessions se resuelve en una consulta, no en una por sesion', async () => {
    // La pantalla de Sesiones pinta el juego de cada fila. Resolver el título
    // consultando por sesión es el N+1 más fácil de escribir aquí.
    await sembrarBiblioteca(8);
    const [sesiones, gasto] = await measure(() => getAllSessions());

    assert.equal(sesiones.length, 16);
    assert.ok(
      gasto.queries <= 2,
      `getAllSessions ha hecho ${gasto.queries} consultas para 16 sesiones`,
    );
  });

  it('getPlannedGames no consulta por juego planeado', async () => {
    // Cada fila del Plan enseña su nota, sus notas de crítica y su fecha: tres
    // datos que invitan a resolverlos uno a uno. La cabecera de la consulta ya
    // avisa de que se hace por lotes; esto lo sujeta.
    for (let i = 0; i < 12; i++) {
      const gameId = await makeGame(db, { title: `Planeado ${i}`, planned: true });
      const iterationId = await makeIteration(db, gameId);
      await makeStateEvent(db, iterationId, 'plan_to_play', '2026-01-01T10:00:00Z');
    }
    const [plan, gasto] = await measure(() => getPlannedGames());

    assert.equal(plan.length, 12);
    assert.ok(
      gasto.queries <= 2,
      `getPlannedGames ha hecho ${gasto.queries} consultas para 12 planeados (hoy hace 1)`,
    );
  });

  it('getSessionUnlocks no crece en consultas con los desbloqueos', async () => {
    // Alimenta las filas de Sesiones Y el overlay in-game, que se abre encima
    // de un juego corriendo: es el sitio donde un N+1 se paga en frames.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-05T18:00:00Z', 3);
    for (let i = 0; i < 30; i++) {
      const achievementId = await makeAchievement(db, gameId, `logro_${i}`);
      await makeUnlock(db, achievementId, '2026-01-05T19:00:00Z');
    }

    const [, gasto] = await measure(() => getSessionUnlocks());

    assert.ok(
      gasto.queries <= 2,
      `getSessionUnlocks ha hecho ${gasto.queries} consultas para 30 desbloqueos (hoy hace 1)`,
    );
  });
});
