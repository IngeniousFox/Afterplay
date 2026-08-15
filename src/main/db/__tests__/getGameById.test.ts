import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { GameDetail, IterationDetail } from '../../../shared/types';
import { spendEventsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeOpenSession,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// getGameById es EL sitio donde el log de eventos se convierte en la ficha que
// se mira: nada de lo que enseña (estado, fechas, horas, gasto por
// playthrough) está guardado en ninguna columna — todo se deriva al leer
// (SPEC 4.4). Por eso este fichero prueba contra una base real y comprueba
// RESULTADOS: un refactor que reordene los bucles o cambie un `<` por un `<=`
// no rompe ninguna firma, rompe la ficha.
//
// Lo que se blinda aquí, por orden de dolor:
//   - las fechas derivadas (inicio = lo más temprano entre la primera sesión y
//     el primer 'started'; fin solo si el playthrough SIGUE terminado hoy),
//   - la ventana de reparto del gasto, que sale de latestRealStateEvent y NO
//     de la última fila del log — la cicatriz del plan_to_play del alta,
//   - las horas por iteración (manual + medido, SUMA),
//   - y que 'plan_to_play' no es un estado nunca, en ninguno de los tres
//     sitios donde se consulta el log.

let db: TestDb;
let getGameById: typeof import('../queries/games/getGameById').getGameById;
let getGames: typeof import('../queries/games/getGames').getGames;

// Los módulos bajo prueba se importan DENTRO del before: el mock.module de
// '../index' que registra el andamio tiene que estar puesto antes de que la
// consulta resuelva su getDb().
before(async () => {
  ({ getGameById } = await import('../queries/games/getGameById'));
  ({ getGames } = await import('../queries/games/getGames'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ── Fábricas y ayudas locales ──────────────────────────────────────────────

// El gasto no tiene fábrica en el andamio (todavía). Por defecto una compra
// con precisión de día, que es como la teclea el modal: a medianoche. Esa
// medianoche es justo lo que hace que los empates de fecha con los eventos de
// estado —también tecleados a día— sean cotidianos y no exóticos.
const makeSpend = async (
  database: TestDb,
  gameId: number,
  occurredAt: string,
  amount: number,
  overrides: Partial<typeof spendEventsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await database
    .insert(spendEventsTable)
    .values({
      gameId,
      type: 'purchase',
      amount,
      occurredAt: new Date(occurredAt),
      datePrecision: 'day',
      ...overrides,
    })
    .returning({ id: spendEventsTable.id });
  return row.id;
};

// getGameById devuelve GameDetail | null y casi todos los tests dan por hecho
// que el juego existe; esto lo estrecha una vez en vez de en cada línea.
const detail = async (gameId: number): Promise<GameDetail> => {
  const game = await getGameById(gameId);
  if (!game) throw new Error(`getGameById(${gameId}) devolvió null y el test esperaba la ficha`);
  return game;
};

// Fechas legibles en los fallos: comparar dos Date en el diff de assert es
// ilegible, comparar dos ISO se lee de un vistazo.
const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

// Las sesiones de una iteración no traen ORDER BY (la query no lo pide), así
// que se ordenan aquí antes de comparar: un test que dependa del orden en que
// SQLite devuelva las filas es un test que fallará el día menos pensado.
const sessionIds = (iteration: IterationDetail): number[] =>
  iteration.sessions.map((session) => session.id).sort((a, b) => a - b);

describe('la ficha de un juego y sus playthroughs', () => {
  it('cada playthrough se lleva SOLO sus sesiones, y el total del juego suma las de todos', async () => {
    const gameId = await makeGame(db, { title: 'Hollow Knight' });
    const first = await makeIteration(db, gameId, { label: 'Primera vuelta' });
    const second = await makeIteration(db, gameId, { label: 'Steel Soul' });

    // Un juego vecino con sesiones el MISMO día: si el filtro por iteraciones
    // se cayera en un refactor, sus 5 horas se colarían en este total y el
    // test de al lado (que solo mira un juego) no se enteraría.
    const otherGameId = await makeGame(db, { title: 'Celeste' });
    const otherIteration = await makeIteration(db, otherGameId);
    await makeSession(db, otherIteration, '2026-01-10T18:00:00Z', 5);

    const s1 = await makeSession(db, first, '2026-01-10T18:00:00Z', 2);
    const s2 = await makeSession(db, first, '2026-01-11T18:00:00Z', 1.5);
    const s3 = await makeSession(db, second, '2026-02-01T20:00:00Z', 3);

    const game = await detail(gameId);
    assert.deepEqual(
      game.iterations.map((iteration) => iteration.label),
      ['Primera vuelta', 'Steel Soul'],
    );
    assert.deepEqual(sessionIds(game.iterations[0]), [s1, s2]);
    assert.deepEqual(sessionIds(game.iterations[1]), [s3]);
    assert.equal(game.iterations[0].hours, 3.5);
    assert.equal(game.iterations[1].hours, 3);
    assert.equal(game.totalHours, 6.5);
  });

  it('un juego sin playthroughs devuelve la ficha vacía y no pierde su gasto', async () => {
    // Dos cosas a la vez, las dos reales: un juego recién añadido desde el
    // buscador no tiene ninguna iteración, y sin ids que meter en el inArray
    // la consulta de sesiones sería un "IN ()" que SQLite rechaza. Y el gasto
    // de la compra, que se registra a nivel de JUEGO, tiene que seguir
    // contando aunque no haya ningún playthrough al que colgárselo.
    const gameId = await makeGame(db, { title: 'Recién añadido' });
    await makeSpend(db, gameId, '2026-01-05T00:00:00Z', 59.99);

    const game = await detail(gameId);
    assert.deepEqual(game.iterations, []);
    assert.equal(game.totalHours, 0);
    assert.equal(game.currentState, null);
    assert.equal(game.isLive, false);
    assert.equal(game.totalSpend, 59.99);
    // Sin horas no hay coste por hora: un 0 en el divisor pintaría Infinity
    // en la ficha, que es peor que no pintar nada.
    assert.equal(game.costPerHour, null);
  });

  it('un id que no existe devuelve null en vez de reventar', async () => {
    // El contrato con el IPC: la ficha de un juego borrado desde otra ventana
    // (o desde el otro PC, vía sync) tiene que poder contestar "ya no está".
    assert.equal(await getGameById(9999), null);
  });

  it('una sesión abierta pone el juego EN VIVO y todavía no suma horas', async () => {
    // El watcher deja la sesión sin fin ni duración mientras el proceso vive.
    // Esas horas no existen hasta que cierra —contarlas a medias sería
    // inventarse tiempo— pero el badge PLAYING sí tiene que encenderse.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);
    await makeOpenSession(db, iterationId, '2026-01-11T20:00:00Z');

    const game = await detail(gameId);
    assert.equal(game.isLive, true);
    assert.equal(game.totalHours, 2);
    // La sesión abierta viaja igual en la lista: el Session History la pinta
    // en marcha, no la esconde hasta que termine.
    assert.equal(game.iterations[0].sessions.length, 2);
  });
});

describe('las fechas derivadas de un playthrough', () => {
  it('el inicio es la primera sesión cuando el watcher se adelantó al evento tecleado', async () => {
    // Le diste a Play y jugaste dos días antes de acordarte de tocar el
    // estado. Manda la medición, y startedBySession es lo que luego impide
    // que el Edit deje corregir esa fecha: una medición no se falsea.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);
    await makeSession(db, iterationId, '2026-01-12T18:00:00Z', 1);
    const startedId = await makeStateEvent(db, iterationId, 'started', '2026-01-11T00:00:00Z', {
      datePrecision: 'day',
    });

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-01-10T18:00:00.000Z');
    assert.equal(iteration.startedBySession, true);
    // El evento sigue viajando aunque no sea el que manda: es el dueño
    // editable de la fecha y el Journey lee su precisión.
    assert.equal(iteration.startEvent?.id, startedId);
  });

  it('el inicio es el evento cuando lo tecleaste con fecha anterior a toda sesión', async () => {
    // El caso inverso y el más común al dar de alta algo antiguo: "empecé
    // esto en marzo", y el watcher solo ha visto lo de este mes.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const startedId = await makeStateEvent(db, iterationId, 'started', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeSession(db, iterationId, '2026-08-01T18:00:00Z', 2);

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-03-01T00:00:00.000Z');
    assert.equal(iteration.startedBySession, false);
    assert.equal(iteration.startEvent?.id, startedId);
    // La precisión viaja con el evento: el Journey pinta "March 2026" y no un
    // día inventado si algún día se guarda con precisión de mes.
    assert.equal(iteration.startEvent?.datePrecision, 'day');
  });

  it('con la sesión y el evento en el mismo instante gana el evento: empatar no es adelantarse', async () => {
    // Borde de un `<` estricto, y no es teórico: al pulsar Play desde la ficha
    // se escribe el 'started' y se abre la sesión en el mismo tramo de código.
    // Si empatar contara como adelantarse, startedBySession saldría true y el
    // Edit dejaría de permitir corregir la fecha de inicio de medio catálogo.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-05-05T12:00:00Z', 1);
    await makeStateEvent(db, iterationId, 'started', '2026-05-05T12:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-05-05T12:00:00.000Z');
    assert.equal(iteration.startedBySession, false);
  });

  it('el inicio es el PRIMER started: reanudar tras una pausa no reescribe el arranque', async () => {
    // Aparcar y retomar es el MISMO playthrough (on_hold no lo cierra), así
    // que su fecha de inicio sigue siendo la de enero. Con el último 'started'
    // en vez del primero, un juego aparcado dos veces iría "empezando" cada
    // vez que vuelves y el tramo del Journey se encogería solo.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const firstStart = await makeStateEvent(db, iterationId, 'started', '2026-01-10T00:00:00Z');
    await makeStateEvent(db, iterationId, 'on_hold', '2026-02-01T00:00:00Z');
    await makeStateEvent(db, iterationId, 'started', '2026-03-01T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-01-10T00:00:00.000Z');
    assert.equal(iteration.startEvent?.id, firstStart);
    assert.equal(iteration.currentState, 'started');
    // Y el on_hold de febrero ya no deja fecha de salida: el estado de HOY es
    // jugando, y un playthrough vivo no tiene fin.
    assert.equal(iteration.endedAt, null);
    assert.equal(iteration.endEvent, null);
  });

  it('un playthrough reabierto no tiene fecha de fin aunque arrastre un completed antiguo', async () => {
    // Lo marcaste como pasado y luego volviste (los créditos no eran el
    // final, o te equivocaste de estado). El completed sigue en el historial,
    // pero la ficha no puede seguir enseñando "Finished" con fecha: el fin es
    // el último evento terminal SOLO si el playthrough está en ese estado hoy.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');
    await makeStateEvent(db, iterationId, 'started', '2026-05-01T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iteration.currentState, 'started');
    assert.equal(iteration.endedAt, null);
    assert.equal(iteration.endEvent, null);
    // El log entero se conserva: lo que se ignora es la DERIVACIÓN, no la
    // historia — el Journey sigue contando que lo terminaste en febrero.
    const game = await detail(gameId);
    assert.deepEqual(
      game.stateHistory.map((event) => event.type),
      ['started', 'completed', 'started'],
    );
  });

  it('on_hold deja fecha de salida y resting no, aunque los dos sean pausas', async () => {
    // SPEC 4.5: "terminal" significa tres cosas distintas y esta es la
    // frontera de leavesEndDate. Aparcar algo deja una fecha que enseñar
    // ("lo dejaste en abril"); un endless que descansa no ha salido de nada,
    // porque nunca hubo un final del que salir. Si alguien unifica los tres
    // conjuntos —hoy son subconjuntos por casualidad del enum—, esto lo canta.
    const parkedId = await makeGame(db, { title: 'Aparcado' });
    const parkedIterationId = await makeIteration(db, parkedId);
    await makeStateEvent(db, parkedIterationId, 'started', '2026-01-01T00:00:00Z');
    const onHoldId = await makeStateEvent(db, parkedIterationId, 'on_hold', '2026-04-01T00:00:00Z');

    const endlessId = await makeGame(db, { title: 'Endless', endless: true });
    const endlessIterationId = await makeIteration(db, endlessId);
    await makeStateEvent(db, endlessIterationId, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, endlessIterationId, 'resting', '2026-04-01T00:00:00Z');

    const [parked] = (await detail(parkedId)).iterations;
    assert.equal(parked.currentState, 'on_hold');
    assert.equal(iso(parked.endedAt), '2026-04-01T00:00:00.000Z');
    assert.equal(parked.endEvent?.id, onHoldId);

    const [endless] = (await detail(endlessId)).iterations;
    assert.equal(endless.currentState, 'resting');
    assert.equal(endless.endedAt, null);
    assert.equal(endless.endEvent, null);
  });

  it('un playthrough sin sesiones ni eventos sale Unplayed y sin ninguna fecha', async () => {
    // Unplayed es un estado por AUSENCIA, no un valor del enum: un juego dado
    // de alta sin decir nada tiene su iteración creada y nada más. Que salga
    // null y no un estado inventado es lo que hace que la ficha lo pinte gris.
    const gameId = await makeGame(db);
    await makeIteration(db, gameId);

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iteration.currentState, null);
    assert.equal(iteration.startedAt, null);
    assert.equal(iteration.endedAt, null);
    assert.equal(iteration.startEvent, null);
    assert.equal(iteration.endEvent, null);
    assert.equal(iteration.startedBySession, false);
    assert.equal(iteration.hours, 0);
    assert.equal(iteration.spend, 0);
  });

  it('dos eventos con la misma fecha exacta: manda el último insertado', async () => {
    // Cotidiano, no exótico: las fechas tecleadas se guardan a medianoche
    // (datePrecision 'day'), así que corregir "me lo pasé" por "lo dejé" el
    // mismo día deja dos eventos con el MISMO occurredAt. Sin el desempate por
    // id, el estado de la ficha dependería del orden en que SQLite devolviera
    // las filas — o sea, de nada.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });
    const droppedId = await makeStateEvent(db, iterationId, 'dropped', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });

    const game = await detail(gameId);
    assert.equal(game.currentState, 'dropped');
    assert.equal(game.iterations[0].endEvent?.id, droppedId);
  });
});

describe("un 'plan_to_play' posterior no puede tapar el desenlace", () => {
  it('el estado y la fecha de fin siguen siendo los del completed del pasado', async () => {
    // El artefacto del alta: planeas un juego HOY (createPlannedGame escribe
    // 'plan_to_play' con la fecha de hoy) y al promocionarlo dices "esto ya me
    // lo pasé en 2023". El plan queda como el evento MÁS RECIENTE del log, y
    // sin filtrarlo el juego salía "planeado" y sin fecha de fin. Por eso el
    // estado sale de latestRealStateEvent y no de la última fila.
    const gameId = await makeGame(db, { title: 'Promovido del Plan' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2023-05-01T00:00:00Z');
    const completedId = await makeStateEvent(db, iterationId, 'completed', '2023-06-01T00:00:00Z');
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-08-13T10:00:00Z');

    const game = await detail(gameId);
    assert.equal(game.currentState, 'completed');
    assert.equal(game.iterations[0].currentState, 'completed');
    assert.equal(iso(game.iterations[0].endedAt), '2023-06-01T00:00:00.000Z');
    assert.equal(game.iterations[0].endEvent?.id, completedId);
    // El plan NO se borra del historial (promotePlannedGame lo conserva a
    // propósito para que se vea cuándo lo apuntaste): se ignora al derivar.
    assert.deepEqual(
      game.stateHistory.map((event) => event.type),
      ['started', 'completed', 'plan_to_play'],
    );
  });

  it('la ventana de gasto se cierra con el completed, no con el plan_to_play del alta', async () => {
    // LA cicatriz de esta función, contada en su propio comentario: con "la
    // última fila del log" en vez de latestRealStateEvent, el plan_to_play
    // fechado hoy dejaba terminalAt=null en el Playthrough 1, su ventana no se
    // cerraba NUNCA y el DLC comprado tres años después se le colgaba a él en
    // vez de al playthrough que estaba abierto en esa fecha.
    const gameId = await makeGame(db, { title: 'Elden Ring' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2023-05-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2023-06-01T00:00:00Z');
    await makeStateEvent(db, first, 'plan_to_play', '2026-08-13T10:00:00Z');

    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-07-01T00:00:00Z');

    await makeSpend(db, gameId, '2023-04-20T00:00:00Z', 60); // la compra
    await makeSpend(db, gameId, '2026-07-05T00:00:00Z', 25); // el DLC, años después

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 60);
    assert.equal(game.iterations[1].spend, 25);
    assert.equal(game.totalSpend, 85);
    // Y de paso el invariante del estado del JUEGO con dos playthroughs: manda
    // el evento más reciente de cualquiera de ellos, no el del primero.
    assert.equal(game.currentState, 'started');
    assert.equal(game.iterations[0].currentState, 'completed');
  });
});

describe('el reparto del gasto entre playthroughs', () => {
  it('un gasto anterior a todo cae en el primer playthrough', async () => {
    // Lo compraste en rebajas de invierno y lo arrancaste en verano: ese
    // dinero es del primer playthrough aunque su ventana empezara después.
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2026-06-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-07-01T00:00:00Z');
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-08-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-01-02T00:00:00Z', 40);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 40);
    assert.equal(game.iterations[1].spend, 0);
  });

  it('cada gasto cae en el primer playthrough que seguía abierto en su fecha', async () => {
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2024-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2024-03-01T00:00:00Z');
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2025-01-01T00:00:00Z');
    await makeStateEvent(db, second, 'dropped', '2025-02-01T00:00:00Z');
    const third = await makeIteration(db, gameId, { label: 'Playthrough 3' });
    await makeStateEvent(db, third, 'started', '2026-01-01T00:00:00Z');

    await makeSpend(db, gameId, '2023-12-01T00:00:00Z', 50); // la compra, antes de todo
    await makeSpend(db, gameId, '2024-02-01T00:00:00Z', 10); // dentro del primero
    // Entre el fin del primero y el arranque del segundo: el primero ya no
    // puede reclamarlo (está cerrado), así que se lo queda el siguiente.
    await makeSpend(db, gameId, '2024-06-01T00:00:00Z', 20);
    await makeSpend(db, gameId, '2026-05-01T00:00:00Z', 5); // en el que sigue abierto

    const game = await detail(gameId);
    assert.deepEqual(
      game.iterations.map((iteration) => iteration.spend),
      [60, 20, 5],
    );
    assert.equal(game.totalSpend, 85);
  });

  it('on_hold no cierra la ventana: aparcar un playthrough no es terminarlo', async () => {
    // El criterio es el mismo que decide si volver a jugar abre un playthrough
    // NUEVO (endsPlaythrough: solo completed y dropped). Un juego aparcado
    // sigue siendo tuyo y en curso, así que el DLC que compras después es
    // suyo, no del playthrough que hiciste mientras tanto en otra plataforma.
    const gameId = await makeGame(db);
    const parked = await makeIteration(db, gameId, { label: 'PC, aparcado' });
    await makeStateEvent(db, parked, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, parked, 'on_hold', '2026-02-01T00:00:00Z');
    const other = await makeIteration(db, gameId, { label: 'Switch, terminado' });
    await makeStateEvent(db, other, 'started', '2026-03-01T00:00:00Z');
    await makeStateEvent(db, other, 'completed', '2026-04-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-05-01T00:00:00Z', 30);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 30);
    assert.equal(game.iterations[1].spend, 0);
  });

  it('el gasto posterior al cierre del último playthrough se lo queda ese último', async () => {
    // No hay ningún playthrough abierto detrás al que pasárselo, y el dinero
    // no puede evaporarse: la suma de los playthroughs tiene que cuadrar con
    // el total del juego SIEMPRE.
    const gameId = await makeGame(db);
    const only = await makeIteration(db, gameId);
    await makeStateEvent(db, only, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, only, 'completed', '2026-02-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-06-01T00:00:00Z', 15, { type: 'ingame_spend' });

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 15);
    assert.equal(game.totalSpend, 15);
  });

  it('un gasto en el instante exacto del cierre se queda en el playthrough que cerraba', async () => {
    // ARREGLADO: la comparación era `<` estricta y el gasto que empataba con
    // la fecha de cierre se caía de la ventana. Empatar no es raro, es lo
    // normal: la fecha del completed y la del gasto se teclean las dos con
    // precisión de día (medianoche), así que comprar el DLC el mismo día que
    // te pasas el juego cae EXACTAMENTE aquí — y esos 20 euros se le colgaban
    // al Playthrough 2, que ese día ni existía (arranca seis meses después).
    // El día que lo cerraste todavía estabas jugándolo: el cierre incluye su
    // propio instante (`<=`).
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-09-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-03-01T00:00:00Z', 20);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 20);
    assert.equal(game.iterations[1].spend, 0);
    assert.equal(game.totalSpend, 20);
  });

  it('un milisegundo después del cierre ya es del siguiente playthrough', async () => {
    // El borde contrario del `<=`, para que el arreglo de arriba no se lea
    // como "el primero se lo queda todo": pasado el instante del cierre la
    // ventana está cerrada de verdad. Un milisegundo es el salto más pequeño
    // que un Date de JS distingue, así que esto fija el corte exacto.
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-09-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-03-01T00:00:00.001Z', 20);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 0);
    assert.equal(game.iterations[1].spend, 20);
  });

  it('el coste por hora sale del gasto y las horas TOTALES del juego', async () => {
    // Se calcula sobre el juego entero, no playthrough a playthrough: la
    // pregunta que contesta es "¿cuánto me ha costado cada hora de esto?".
    const gameId = await makeGame(db);
    // Un playthrough de horas solo manuales y otro solo medido: el coste por
    // hora tiene que ver las dos fuentes, no una.
    await makeIteration(db, gameId, { manualTotalPlayed: 3 });
    const second = await makeIteration(db, gameId);
    await makeSession(db, second, '2026-01-10T18:00:00Z', 1);
    await makeSpend(db, gameId, '2026-01-01T00:00:00Z', 100);

    const game = await detail(gameId);
    assert.equal(game.totalHours, 4);
    assert.equal(game.totalSpend, 100);
    assert.equal(game.costPerHour, 25);
  });
});

describe('las horas de cada playthrough', () => {
  it('las horas manuales se SUMAN a lo medido, no lo reemplazan (SPEC 4.4)', async () => {
    // La cicatriz de iterationHours.ts: cuando reemplazaba, un playthrough con
    // horas manuales que seguía vivo se quedaba clavado en el número manual
    // para siempre — las sesiones nuevas se guardaban, se veían en el Session
    // History, y el total las ignoraba. Son tiempos DISJUNTOS: las manuales
    // son lo jugado fuera del tracking.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 40 });
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].hours, 42);
    assert.equal(game.totalHours, 42);
  });

  it('getGames y getGameById cuentan las mismas horas y las mismas sesiones', async () => {
    // Divergencia vigilada: la biblioteca y la ficha derivan lo mismo por
    // caminos distintos (una agrega con JOIN sobre todos los juegos, la otra
    // agrupa en memoria los de uno solo). Ya pasó con las horas manuales en
    // Stats — dos sitios que decían aplicar "la misma regla" y no coincidían —
    // y la forma de que no vuelva a pasar es compararlos en un test.
    const gameId = await makeGame(db, { title: 'El mismo juego' });
    const first = await makeIteration(db, gameId, { manualTotalPlayed: 12.5 });
    await makeSession(db, first, '2026-01-10T18:00:00Z', 2);
    const second = await makeIteration(db, gameId);
    await makeSession(db, second, '2026-02-10T18:00:00Z', 1.5);
    await makeOpenSession(db, second, '2026-03-10T18:00:00Z');
    await makeStateEvent(db, second, 'started', '2026-02-10T00:00:00Z');
    await makeStateEvent(db, second, 'plan_to_play', '2026-08-13T10:00:00Z');

    const detailed = await detail(gameId);
    const [listed] = await getGames();

    assert.equal(listed.totalHours, detailed.totalHours);
    assert.equal(listed.currentState, detailed.currentState);
    assert.equal(listed.isLive, detailed.isLive);
    // La sesión ABIERTA cuenta en las dos: el overlay ya sumó una vez "+1 por
    // la de ahora" dando por hecho que la lista solo contaba las cerradas, y
    // todo juego en marcha enseñaba una sesión de más.
    assert.equal(
      listed.sessionCount,
      detailed.iterations.reduce((total, iteration) => total + iteration.sessions.length, 0),
    );
  });

  it('una sesión heredada con isManual NO arrastra el inicio ni lo marca como medido', async () => {
    // ARREGLADO: la derivación del inicio no filtraba `isManual`, así que una
    // fila antigua del modelo v1 (hoy ya nadie las escribe, pero las bases
    // viejas las tienen) se trataba como una MEDICIÓN. El inicio saltaba a
    // 2020 y, peor, startedBySession salía true — que es justo la señal con
    // la que el Edit bloquea la fecha "porque una medición no se falsea": se
    // bloqueaba la edición de una fecha que nadie midió. Una sesión manual es
    // un bloque de horas TECLEADO, no algo que el watcher viera pasar, así
    // que manda el evento y la fecha sigue siendo editable. Mismo criterio
    // que Stats y los momentos, que ya filtraban esas filas.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2020-01-01T00:00:00Z', 30, { isManual: true });
    const startedId = await makeStateEvent(db, iterationId, 'started', '2026-01-10T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-01-10T00:00:00.000Z');
    assert.equal(iteration.startedBySession, false);
    // La fecha sigue teniendo dueño editable: el evento, que es lo que el
    // Edit necesita para dejar corregirla.
    assert.equal(iteration.startEvent?.id, startedId);
    // Y las horas de esa fila NO se pierden: lo que se descarta es su fecha
    // como medición del arranque, no el tiempo que dice haber jugado.
    assert.equal(iteration.hours, 30);
  });

  it('una sesión medida posterior a otra manual sigue mandando sobre el evento', async () => {
    // El borde que la guarda nueva podría haberse llevado por delante: en un
    // playthrough con las dos clases de fila, la MEDIDA sigue derivando el
    // inicio si se adelanta al evento tecleado. El filtro descarta la manual,
    // no todas las sesiones.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2020-01-01T00:00:00Z', 30, { isManual: true });
    await makeSession(db, iterationId, '2026-01-05T18:00:00Z', 2);
    await makeStateEvent(db, iterationId, 'started', '2026-01-10T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-01-05T18:00:00.000Z');
    assert.equal(iteration.startedBySession, true);
  });

  it('con SOLO horas manuales y ningún evento no hay fecha de inicio que enseñar', async () => {
    // El otro lado del filtro: sin medición ni evento no se inventa una
    // fecha. La medianoche gruesa de una fila v1 no es "el día que empecé
    // esto"; pintarla en el Journey sería contar algo que nadie afirmó.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2020-01-01T00:00:00Z', 30, { isManual: true });

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iteration.startedAt, null);
    assert.equal(iteration.startedBySession, false);
    assert.equal(iteration.startEvent, null);
    assert.equal(iteration.hours, 30);
  });
});
