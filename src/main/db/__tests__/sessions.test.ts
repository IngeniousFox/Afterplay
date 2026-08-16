import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { iterationColumns, sessionColumns, stateEventColumns } from '../projections';
import { emulatorsTable, iterationsTable, sessionsTable, stateEventsTable } from '../schema';
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

// EL CICLO DE VIDA DE UNA SESIÓN, sobre base real: abrirla (startGameSession),
// cerrarla (closeSession / closeSessionIfOpen), asignarla si vino de un
// emulador (assignSession) y borrarla (deleteSession).
//
// Todo lo que cuenta esta app —las horas de un juego, el heatmap, las rachas,
// los momentos, el reparto del gasto— se deriva de estas filas. Por eso lo que
// se blinda aquí no son las funciones, son los INVARIANTES que un refactor
// rompe sin enterarse:
//
//   · una sesión no se cierra dos veces (ni se le pisa la duración)
//   · un juego no tiene dos sesiones abiertas a la vez
//   · una duración nunca es negativa
//   · un rechazo no deja a medias un playthrough fantasma
//   · como mucho UN playthrough activo por juego (SPEC 4.5), también cuando
//     la escritura llega con fecha del pasado
//
// Los módulos bajo prueba se importan DENTRO del before(): el mock.module del
// andamio tiene que estar registrado antes (ver harness.ts).

let db: TestDb;
let closeSession: typeof import('../queries/sessions/closeSession').closeSession;
let closeSessionIfOpen: typeof import('../queries/sessions/closeSession').closeSessionIfOpen;
let computeDurationSec: typeof import('../queries/sessions/sessionDuration').computeDurationSec;
let startGameSession: typeof import('../queries/sessions/startGameSession').startGameSession;
let assignSession: typeof import('../queries/sessions/assignSession').assignSession;
let deleteSession: typeof import('../queries/sessions/deleteSession').deleteSession;
let deletePendingSession: typeof import('../queries/sessions/deletePendingSession').deletePendingSession;

before(async () => {
  ({ closeSession, closeSessionIfOpen } = await import('../queries/sessions/closeSession'));
  ({ computeDurationSec } = await import('../queries/sessions/sessionDuration'));
  ({ startGameSession } = await import('../queries/sessions/startGameSession'));
  ({ assignSession } = await import('../queries/sessions/assignSession'));
  ({ deleteSession } = await import('../queries/sessions/deleteSession'));
  ({ deletePendingSession } = await import('../queries/sessions/deletePendingSession'));
});

beforeEach(async () => {
  db = await freshDb();
});

after(() => cleanupDbs());

// ── Fábricas y lecturas locales ────────────────────────────────────────────
// El andamio no trae emuladores ni sesiones pendientes; se quedan aquí para
// no tocar firmas que otros tests ya están usando.

type SessionRow = typeof sessionsTable.$inferSelect;
type IterationRow = typeof iterationsTable.$inferSelect;
type StateEventRow = typeof stateEventsTable.$inferSelect;

const makeEmulator = async (database: TestDb, name = 'DuckStation'): Promise<number> => {
  const [row] = await database
    .insert(emulatorsTable)
    .values({ name, executablePath: `C:/Emus/${name}/${name}.exe` })
    .returning({ id: emulatorsTable.id });
  return row.id;
};

// Una sesión tal y como nace de un emulador (EMULADORES.md §4): con
// `emulatorId` y SIN juego (`iterationId` null) — la bandeja "Pending".
// `hours: null` la deja ABIERTA, que es como vive mientras el emulador corre.
const makePendingSession = async (
  database: TestDb,
  emulatorId: number,
  startedAt: string,
  hours: number | null,
): Promise<number> => {
  const start = new Date(startedAt);
  const [row] = await database
    .insert(sessionsTable)
    .values({
      iterationId: null,
      emulatorId,
      isManual: false,
      startedAt: start,
      endedAt: hours === null ? null : new Date(start.getTime() + hours * 3600 * 1000),
      durationSec: hours === null ? null : Math.round(hours * 3600),
      datePrecision: 'datetime',
    })
    .returning({ id: sessionsTable.id });
  return row.id;
};

const readSession = async (database: TestDb, id: number): Promise<SessionRow | undefined> => {
  const [row] = await database
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  return row;
};

const sessionsOfGame = async (database: TestDb, gameId: number): Promise<SessionRow[]> =>
  database
    .select(sessionColumns)
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(sessionsTable.id));

const iterationsOfGame = async (database: TestDb, gameId: number): Promise<IterationRow[]> =>
  database
    .select(iterationColumns)
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

const stateEventsOfGame = async (database: TestDb, gameId: number): Promise<StateEventRow[]> =>
  database
    .select(stateEventColumns)
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id))
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));

// "¿Cuántos playthroughs de este juego están activos?" — el invariante de
// SPEC 4.5 vale UNO como mucho, y hace falta comprobarlo desde fuera después
// de cada escritura que puede activar algo.
const activePlaythroughs = async (database: TestDb, gameId: number): Promise<number[]> => {
  const events = await stateEventsOfGame(database, gameId);
  const latestByIteration = new Map<number, StateEventRow>();
  for (const event of events) {
    if (event.type === 'plan_to_play') continue;
    latestByIteration.set(event.iterationId, event);
  }
  return [...latestByIteration.entries()]
    .filter(([, event]) => event.type === 'started')
    .map(([iterationId]) => iterationId);
};

// ══ computeDurationSec ═════════════════════════════════════════════════════

describe('computeDurationSec: la duración de una sesión no puede mentir', () => {
  it('redondea al segundo más cercano, hacia arriba desde el medio segundo', () => {
    // Es un `int` en la base y la suma de todos ellos son las horas de un
    // juego. El redondeo importa poco por sesión y mucho por biblioteca: si
    // alguien lo cambia por Math.floor/ceil, cada sesión de la vida del
    // usuario cambia de valor a la vez y nadie sabría decir por qué.
    const start = new Date('2026-01-10T18:00:00.000Z');
    assert.equal(computeDurationSec(start, new Date('2026-01-10T20:30:00.000Z')), 9000);
    assert.equal(computeDurationSec(start, new Date('2026-01-10T18:00:01.499Z')), 1);
    assert.equal(computeDurationSec(start, new Date('2026-01-10T18:00:01.500Z')), 2);
  });

  it('un fin ANTERIOR al inicio da 0, nunca una duración negativa', () => {
    // Una negativa no sería "una sesión rara": entraría restando en el total
    // de horas del juego, en el heatmap y en las rachas, y una tarde de
    // partida podría QUITAR horas jugadas. El Math.max(0) es ese muro.
    // Puede llegar de un reloj torcido (dos PCs sincronizando por Turso) o de
    // un hito terminal fechado en el pasado (ver addStateEvent.ts).
    const start = new Date('2026-01-10T18:00:00Z');
    assert.equal(computeDurationSec(start, new Date('2026-01-10T17:00:00Z')), 0);
  });

  it('un fin exactamente igual al inicio es 0, no un segundo de regalo', () => {
    // El caso real de la recuperación al arrancar: una sesión sin ningún
    // latido se cierra en su propio startedAt (watcher.ts) — cero segundos, y
    // eso es lo honesto.
    const start = new Date('2026-01-10T18:00:00Z');
    assert.equal(computeDurationSec(start, start), 0);
  });
});

// ══ closeSession / closeSessionIfOpen ══════════════════════════════════════

describe('cerrar una sesión: idempotencia y quién tiene derecho a cantarlo', () => {
  it('closeSessionIfOpen cierra la que estaba abierta y devuelve la fila ya cerrada', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    const closed = await closeSessionIfOpen(sessionId, new Date('2026-01-10T20:30:00Z'));

    assert.equal(closed?.id, sessionId);
    assert.equal(closed?.durationSec, 9000);
    assert.equal(closed?.endedAt?.toISOString(), '2026-01-10T20:30:00.000Z');
    // Y en la base, no solo en el valor devuelto.
    const stored = await readSession(db, sessionId);
    assert.equal(stored?.durationSec, 9000);
  });

  it('una sesión ya cerrada no se vuelve a cerrar: devuelve null y su duración queda intacta', async () => {
    // LA CICATRIZ (ver cabecera de closeSession.ts): pulsas Stop en la ficha
    // con el juego todavía abierto — la sesión se cierra a las 20:30 y a
    // partir de ahí ya no se cuenta más tiempo, que es justo lo que pediste.
    // Cuatro horas después cierras el juego de verdad y el watcher llama
    // sobre ESA MISMA sesión. Sin la guarda le pisaría las 2h30 medidas con
    // 6h30 infladas, y volvería a cantar el aviso de "sesión cerrada" con el
    // diario "¿dónde lo dejaste?" pidiéndose por segunda vez.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');
    await closeSessionIfOpen(sessionId, new Date('2026-01-10T20:30:00Z'));

    const second = await closeSessionIfOpen(sessionId, new Date('2026-01-11T00:30:00Z'));

    assert.equal(second, null);
    const stored = await readSession(db, sessionId);
    assert.equal(stored?.durationSec, 9000);
    assert.equal(stored?.endedAt?.toISOString(), '2026-01-10T20:30:00.000Z');
  });

  it('closeSession sobre una ya cerrada la devuelve TAL CUAL, sin recalcular nada', async () => {
    // La otra mitad del contrato: closeSession es idempotente pero SÍ contesta
    // con la fila. Llamarla mil veces con fechas distintas tiene que dar
    // siempre la misma sesión, con la duración del primer cierre.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    const first = await closeSession(sessionId, new Date('2026-01-10T20:30:00Z'));
    const again = await closeSession(sessionId, new Date('2026-01-12T09:00:00Z'));

    assert.equal(first?.durationSec, 9000);
    assert.equal(again?.durationSec, 9000);
    assert.equal(again?.endedAt?.toISOString(), '2026-01-10T20:30:00.000Z');
  });

  it('la asimetría es el contrato: sobre la misma sesión cerrada, una dice null y la otra devuelve fila', async () => {
    // De este valor de retorno cuelgan el aviso de cierre y el backup de la
    // partida (watcher.ts). "Devuelve fila" NO puede significar "la he cerrado
    // yo": por eso el watcher usa closeSessionIfOpen y el botón Stop
    // closeSession. Si alguien unifica las dos en una, el toast duplicado de
    // la cicatriz de arriba vuelve el mismo día.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');
    await closeSession(sessionId, new Date('2026-01-10T20:30:00Z'));

    const endedAt = new Date('2026-01-10T23:00:00Z');
    assert.equal(await closeSessionIfOpen(sessionId, endedAt), null);
    assert.equal((await closeSession(sessionId, endedAt))?.id, sessionId);
  });

  it('una sesión que no existe devuelve null por las dos puertas, sin reventar', async () => {
    // Pasa de verdad: borras la sesión desde la vista de Sesiones mientras el
    // watcher la sigue teniendo en su mapa en memoria (ver deleteSession.ts).
    // El ciclo siguiente cierra un id fantasma y no puede tumbar el watcher.
    assert.equal(await closeSessionIfOpen(9999, new Date('2026-01-10T20:00:00Z')), null);
    assert.equal(await closeSession(9999, new Date('2026-01-10T20:00:00Z')), null);
  });

  it('cerrar con una fecha anterior a su inicio no cierra nada: la sesion se queda abierta', async () => {
    // La guarda que faltaba, y que addStateEvent ya tenia para el mismo
    // calculo. Sin ella la fila quedaba con endedAt < startedAt (un dato que
    // ninguna lectura de la app sabe interpretar) y durationSec 0 por el
    // Math.max(0) de computeDurationSec — o sea las horas medidas de esa tarde
    // a la basura, y sin arreglo posible despues porque cerrar es idempotente.
    //
    // Dejarla ABIERTA es lo reversible: el watcher la cerrara bien cuando
    // muera el proceso.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    assert.equal(await closeSessionIfOpen(sessionId, new Date('2026-01-09T10:00:00Z')), null);

    const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    assert.equal(row.endedAt, null);
    assert.equal(row.durationSec, null);
  });
});

// ══ startGameSession ═══════════════════════════════════════════════════════

describe('startGameSession: un juego no puede tener dos sesiones abiertas', () => {
  it('un juego sin playthroughs estrena uno, lo deja activo y le cuelga una sesión medida abierta', async () => {
    const gameId = await makeGame(db, { title: 'Hollow Knight' });

    const session = await startGameSession(gameId);

    const iterations = await iterationsOfGame(db, gameId);
    assert.equal(iterations.length, 1);
    assert.equal(iterations[0].label, 'Playthrough 1');
    assert.equal(session?.iterationId, iterations[0].id);
    // Tiempo MEDIDO y abierto: isManual false (las manuales ya no se fabrican,
    // ver schema.ts) y sin fin ni duración hasta que el watcher la cierre.
    assert.equal(session?.isManual, false);
    assert.equal(session?.endedAt, null);
    assert.equal(session?.durationSec, null);
    assert.equal(session?.emulatorId, null);
    // 'watcher' y no 'timer': el cronómetro del móvil es la única vía que
    // marca otra cosa, y confundirlas haría que reconcileOpenSessions cerrara
    // esta sesión en el acto con duración 0 (ver schema.ts, startedBy).
    assert.equal(session?.startedBy, 'watcher');

    const events = await stateEventsOfGame(db, gameId);
    assert.deepEqual(
      events.map((event) => event.type),
      ['started'],
    );
    // UN solo instante para el evento y la sesión: startGameSession resuelve
    // `now` una vez y lo reparte. Con dos `new Date()` distintos, el 'started'
    // caería milisegundos después del inicio de la sesión y la fecha derivada
    // del playthrough dejaría de coincidir con su primera sesión.
    assert.equal(events[0].occurredAt.getTime(), session?.startedAt.getTime());
  });

  it('con una sesión ya abierta devuelve null y no abre una segunda ni deja rastro', async () => {
    // La regla que impide contar dos veces la misma tarde: el botón Play y el
    // watcher pueden dispararse casi a la vez (arrancas el juego desde la
    // ficha y el sondeo lo detecta cinco segundos después).
    const gameId = await makeGame(db);
    const first = await startGameSession(gameId);
    assert.ok(first);

    const second = await startGameSession(gameId);

    assert.equal(second, null);
    assert.equal((await sessionsOfGame(db, gameId)).length, 1);
    // Y el null es limpio: ni un playthrough de más ni un "Started" de más en
    // el Journey. Un refactor que resolviera la iteración ANTES del dedup
    // dejaría ese rastro y seguiría devolviendo null, o sea pasaría sin ruido.
    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
    assert.equal((await stateEventsOfGame(db, gameId)).length, 1);
  });

  it('la guarda es por JUEGO, no por playthrough: una abierta en un playthrough terminado bloquea igual', async () => {
    // Escenario real: pasas el juego a Beaten con la fecha de la semana pasada
    // (una corrección del historial) mientras SIGUE corriendo — addStateEvent
    // se niega a cerrar la sesión viva con esa fecha, así que queda una sesión
    // abierta colgando de un playthrough ya terminado. Volver a darle a Play
    // no puede abrir otra: serían dos relojes contando la misma partida.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-01-05T12:00:00Z');
    await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    assert.equal(await startGameSession(gameId), null);
    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
  });

  it('una sesión abierta de OTRO juego no bloquea nada', async () => {
    // El dedup filtra por gameId; sin ese filtro, dejar un juego en marcha
    // convertiría el Play de toda la biblioteca en un no-op.
    const busyGameId = await makeGame(db, { title: 'Elden Ring' });
    const busyIterationId = await makeIteration(db, busyGameId);
    await makeOpenSession(db, busyIterationId, '2026-01-10T18:00:00Z');
    const otherGameId = await makeGame(db, { title: 'Celeste' });

    const session = await startGameSession(otherGameId);

    assert.ok(session);
    assert.equal((await sessionsOfGame(db, otherGameId)).length, 1);
  });

  it('una sesión CERRADA no bloquea: se reanuda el mismo playthrough en pausa', async () => {
    // On Hold es una pausa, no un final (SPEC 4.5): retomar sigue el MISMO
    // playthrough. Si esto creara uno nuevo, cada vuelta tras un parón partiría
    // el juego en trozos y las horas de cada playthrough dejarían de significar
    // nada.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T10:00:00Z');
    await makeSession(db, iterationId, '2026-01-01T10:00:00Z', 3);
    await makeStateEvent(db, iterationId, 'on_hold', '2026-01-03T20:00:00Z');

    const session = await startGameSession(gameId);

    assert.equal(session?.iterationId, iterationId);
    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
    assert.deepEqual(await activePlaythroughs(db, gameId), [iterationId]);
  });

  it('si el último playthrough terminó, la sesión cuelga del NUEVO y el viejo no se reabre', async () => {
    // SPEC 4: Beaten/Dropped cierran el playthrough para siempre. Colgar la
    // segunda vuelta del primero le sumaría horas a una partida que ya tiene
    // su nota y su fecha de final.
    const gameId = await makeGame(db);
    const firstIterationId = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, firstIterationId, 'started', '2026-01-01T10:00:00Z');
    await makeStateEvent(db, firstIterationId, 'completed', '2026-01-20T22:00:00Z');

    const session = await startGameSession(gameId);

    const iterations = await iterationsOfGame(db, gameId);
    assert.equal(iterations.length, 2);
    assert.equal(iterations[1].label, 'Playthrough 2');
    assert.equal(session?.iterationId, iterations[1].id);
    // Y solo el nuevo queda activo: el primero sigue Completed.
    assert.deepEqual(await activePlaythroughs(db, gameId), [iterations[1].id]);
  });

  it('una sesión pendiente de emulador abierta no bloquea a ningún juego', async () => {
    // Una pendiente no cuelga de ninguna iteración (EMULADORES.md §6), así que
    // el inner join del dedup la deja fuera — y tiene que seguir siendo así:
    // con un left join, tener el emulador abierto haría que el Play de
    // cualquier juego de la biblioteca no hiciera nada.
    const emulatorId = await makeEmulator(db);
    await makePendingSession(db, emulatorId, '2026-01-10T18:00:00Z', null);
    const gameId = await makeGame(db, { title: 'Chrono Trigger', isEmulated: true });

    const session = await startGameSession(gameId);

    assert.ok(session);
    assert.equal(session.endedAt, null);
  });
});

// ══ assignSession ══════════════════════════════════════════════════════════

describe('assignSession: la sesión de emulador encuentra su juego (EMULADORES.md §6)', () => {
  it('asigna el playthrough, conserva el emulador y fecha el arranque en cuando SE JUGÓ', async () => {
    // La fecha es lo delicado: el evento 'started' nace con la fecha REAL de
    // la sesión (20 de julio), no con la del momento de asignarla. Si naciera
    // "ahora", el juego constaría como empezado en agosto y las horas de julio
    // caerían en el mes equivocado del heatmap y de los recaps.
    const emulatorId = await makeEmulator(db, 'DuckStation');
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', 2);
    const gameId = await makeGame(db, { title: 'Silent Hill', isEmulated: true });

    const assigned = await assignSession(sessionId, gameId);

    const iterations = await iterationsOfGame(db, gameId);
    assert.equal(iterations.length, 1);
    assert.equal(assigned?.iterationId, iterations[0].id);
    // Un juego emulado estrena su playthrough con plataforma 'Emulated'.
    assert.equal(iterations[0].playedPlatform, 'Emulated');
    // El emulador se conserva a propósito (EMULADORES.md §5): queda como
    // registro de qué emulador generó la sesión, incluso ya asignada.
    assert.equal(assigned?.emulatorId, emulatorId);
    // Y las horas medidas no se tocan al asignar.
    assert.equal(assigned?.durationSec, 7200);

    const events = await stateEventsOfGame(db, gameId);
    assert.deepEqual(
      events.map((event) => [event.type, event.occurredAt.toISOString()]),
      [['started', '2026-07-20T21:00:00.000Z']],
    );
  });

  it('regla 3 de §6: un juego que no está marcado como emulado la rechaza, y no deja rastro', async () => {
    // El filtro del modal ya solo enseña juegos emulados; esto es el backend
    // imponiendo la misma regla. Lo que se blinda además es el ROLLBACK: si
    // alguien mueve la comprobación por debajo de resolveIterationForPlay, el
    // rechazo dejaría un "Playthrough 1" fantasma con su 'started' en un juego
    // que nunca recibió la sesión.
    const emulatorId = await makeEmulator(db);
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', 2);
    const gameId = await makeGame(db, { title: 'Celeste', isEmulated: false });

    await assert.rejects(() => assignSession(sessionId, gameId), /no está marcado como emulado/);

    assert.equal((await readSession(db, sessionId))?.iterationId, null);
    assert.equal((await iterationsOfGame(db, gameId)).length, 0);
    assert.equal((await stateEventsOfGame(db, gameId)).length, 0);
  });

  it('una sesión que ya tiene playthrough no se reasigna a otro juego', async () => {
    // Reasignar movería horas ya contabilizadas de un juego a otro por la
    // puerta de atrás. Si algún día hace falta, será una operación con nombre
    // propio, no un segundo clic en "Assign".
    const emulatorId = await makeEmulator(db);
    const firstGameId = await makeGame(db, { title: 'Silent Hill', isEmulated: true });
    const iterationId = await makeIteration(db, firstGameId);
    const sessionId = await makeSession(db, iterationId, '2026-07-20T21:00:00Z', 2, { emulatorId });
    const otherGameId = await makeGame(db, { title: 'Resident Evil', isEmulated: true });

    await assert.rejects(() => assignSession(sessionId, otherGameId), /ya está asignada/);

    assert.equal((await readSession(db, sessionId))?.iterationId, iterationId);
    assert.equal((await iterationsOfGame(db, otherGameId)).length, 0);
  });

  it('una sesión inexistente devuelve null, pero un juego inexistente revienta', async () => {
    // No es lo mismo "eso ya no está" que "eso no se puede". La sesión pudo
    // desaparecer entre que se pintó la bandeja y se pulsó Assign (otro PC la
    // asignó y llegó por el sync): null y a refrescar. Un gameId que no existe
    // es un error de programa y tiene que sonar.
    const emulatorId = await makeEmulator(db);
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', 2);
    const gameId = await makeGame(db, { isEmulated: true });

    assert.equal(await assignSession(9999, gameId), null);
    await assert.rejects(() => assignSession(sessionId, 9999), /No existe el juego/);
  });

  it('SPEC 4.5: una sesión retroactiva se cuelga del playthrough activo HOY en vez de estrenar otro', async () => {
    // La cicatriz de resolveIterationForPlay: sesión del 20-jul asignada en
    // agosto, cuando su playthrough ya estaba Beaten. Mirando SOLO la foto del
    // 20-jul, el último evento era 'completed' y la respuesta era "playthrough
    // nuevo" — un fantasma fechado en julio, con un 'started' como último
    // evento (o sea activo para siempre) y DOS playthroughs activos a la vez,
    // contra SPEC 4.5. La sesión tiene que caer en el que está vivo ahora.
    const emulatorId = await makeEmulator(db);
    const gameId = await makeGame(db, { title: 'Chrono Trigger', isEmulated: true });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-07-01T10:00:00Z');
    await makeStateEvent(db, iterationId, 'completed', '2026-07-10T23:00:00Z');
    await makeStateEvent(db, iterationId, 'started', '2026-08-01T18:00:00Z');
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', 2);

    const assigned = await assignSession(sessionId, gameId);

    assert.equal(assigned?.iterationId, iterationId);
    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
    // Sin eventos nuevos: el playthrough ya estaba activo, y un 'started'
    // fechado en julio solo añadiría un "Started" de más al Journey.
    assert.equal((await stateEventsOfGame(db, gameId)).length, 3);
    assert.deepEqual(await activePlaythroughs(db, gameId), [iterationId]);
  });

  it('si el destino ya arrancó DESPUÉS de la sesión, no se le añade un segundo "Started"', async () => {
    // El otro agujero de la misma cabecera: jugaste al emulador el martes y el
    // playthrough arrancó el viernes. A fecha del martes esa iteración no
    // tiene ningún evento, así que el insert "para activarla" no activaba nada
    // —ya lo estaba— y solo dejaba un Started duplicado en el historial,
    // moviendo además el ancla de las horas manuales.
    const emulatorId = await makeEmulator(db);
    const gameId = await makeGame(db, { isEmulated: true });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-07-25T10:00:00Z');
    await makeStateEvent(db, iterationId, 'on_hold', '2026-08-01T10:00:00Z');
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', 2);

    const assigned = await assignSession(sessionId, gameId);

    assert.equal(assigned?.iterationId, iterationId);
    const events = await stateEventsOfGame(db, gameId);
    assert.deepEqual(
      events.map((event) => event.type),
      ['started', 'on_hold'],
    );
  });

  it('una sesión de emulador todavía en marcha se puede asignar: sigue abierta y ya con dueño', async () => {
    // Asignar en caliente es legítimo (el aviso de cierre y el backup los
    // lanzará el watcher al cerrarla, ya con el juego a bordo — ipc/sessions).
    // Lo que NO puede pasar es que, ya con dueño, el juego admita abrir otra
    // sesión: serían dos relojes sobre la misma partida.
    const emulatorId = await makeEmulator(db);
    const sessionId = await makePendingSession(db, emulatorId, '2026-07-20T21:00:00Z', null);
    const gameId = await makeGame(db, { isEmulated: true });

    const assigned = await assignSession(sessionId, gameId);

    assert.equal(assigned?.endedAt, null);
    assert.equal(assigned?.durationSec, null);
    assert.ok(assigned?.iterationId);
    assert.equal(await startGameSession(gameId), null);
  });
});

// ══ deleteSession ══════════════════════════════════════════════════════════

describe('deleteSession: una sesión abierta no se borra', () => {
  it('borra una sesión cerrada y lo confirma', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);

    assert.equal(await deleteSession(sessionId), true);
    assert.equal(await readSession(db, sessionId), undefined);
  });

  it('una sesión abierta se niega a borrarse, y sigue ahí después del intento', async () => {
    // LA CICATRIZ (cabecera de deleteSession.ts): el peligro no es que el
    // watcher la reabra, es que se queda siguiendo un id que ya no existe —
    // los latidos escriben en el vacío y al morir el proceso el cierre
    // devuelve null, así que se pierde el resto de la partida entera y ni
    // siquiera salta el aviso de cierre, que cuelga de ese mismo retorno.
    // Primero se para (botón Stop) y luego se borra.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    await assert.rejects(() => deleteSession(sessionId), /sigue abierta/);

    const stored = await readSession(db, sessionId);
    assert.ok(stored);
    assert.equal(stored.endedAt, null);
  });

  it('borrar una sesión que no existe es false, no una excepción', async () => {
    // La distinción importa para la UI: false es "ya no estaba" (otra pestaña,
    // otro PC por el sync) y se refresca sin más; la excepción de arriba es
    // "no puedes todavía" y sí se le cuenta al usuario.
    assert.equal(await deleteSession(9999), false);
  });

  it('borrar la sesión no toca el historial: el "Started" que nació con ella sigue siendo verdad', async () => {
    // Modelo v2: las sesiones son filas independientes y las fechas del
    // playthrough se derivan del log de estados. Borrar una sesión recalcula
    // horas y contadores, pero un 'started' es un hecho histórico — haberlo
    // empezado aquel día pasó, aunque esa medición concreta se borre.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-10T18:00:00Z');
    const sessionId = await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);

    assert.equal(await deleteSession(sessionId), true);

    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
    assert.deepEqual(
      (await stateEventsOfGame(db, gameId)).map((event) => event.type),
      ['started'],
    );
  });

  it('una pendiente EN MARCHA tampoco se descarta: el backend dice que no', async () => {
    // Las dos puertas de borrado protegen ya lo mismo. deletePendingSession no
    // miraba endedAt —solo que la sesion no tuviera juego—, asi que una sesion
    // de emulador viva se podia descartar mientras el watcher la tenia en su
    // mapa: latidos al vacio, cierre en null al morir el proceso, el resto de
    // la sesion perdido y sin aviso de cierre. Exactamente el escenario que
    // deleteSession considera inaceptable.
    //
    // La unica guarda viva era de interfaz (la bandeja esconde el boton
    // mientras la card esta LIVE), asi que el dia que aparezca otro llamador
    // —el movil de REMOTO.md, un atajo— esto es lo que le dice que no.
    const emulatorId = await makeEmulator(db);
    const sessionId = await makePendingSession(db, emulatorId, '2026-01-10T18:00:00Z', null);

    assert.equal(await deletePendingSession(sessionId), false);
    assert.ok(await readSession(db, sessionId));
  });

  it('una pendiente ya CERRADA si se descarta', async () => {
    // El caso para el que existe la funcion: abriste el emulador para
    // configurarlo, no para jugar, y esa fila no es de nadie.
    const emulatorId = await makeEmulator(db);
    const sessionId = await makePendingSession(db, emulatorId, '2026-01-10T18:00:00Z', 1);

    assert.equal(await deletePendingSession(sessionId), true);
    assert.equal(await readSession(db, sessionId), undefined);
  });

  it('una sesión abierta se niega a borrarse, y sigue ahí después del intento', async () => {
    // LA CICATRIZ (cabecera de deleteSession.ts): el peligro no es que el
    // watcher la reabra, es que se queda siguiendo un id que ya no existe —
    // los latidos escriben en el vacío y al morir el proceso el cierre
    // devuelve null, así que se pierde el resto de la partida entera y ni
    // siquiera salta el aviso de cierre, que cuelga de ese mismo retorno.
    // Primero se para (botón Stop) y luego se borra.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-01-10T18:00:00Z');

    await assert.rejects(() => deleteSession(sessionId), /sigue abierta/);

    const stored = await readSession(db, sessionId);
    assert.ok(stored);
    assert.equal(stored.endedAt, null);
  });

  it('borrar una sesión que no existe es false, no una excepción', async () => {
    // La distinción importa para la UI: false es "ya no estaba" (otra pestaña,
    // otro PC por el sync) y se refresca sin más; la excepción de arriba es
    // "no puedes todavía" y sí se le cuenta al usuario.
    assert.equal(await deleteSession(9999), false);
  });

  it('borrar la sesión no toca el historial: el "Started" que nació con ella sigue siendo verdad', async () => {
    // Modelo v2: las sesiones son filas independientes y las fechas del
    // playthrough se derivan del log de estados. Borrar una sesión recalcula
    // horas y contadores, pero un 'started' es un hecho histórico — haberlo
    // empezado aquel día pasó, aunque esa medición concreta se borre.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-10T18:00:00Z');
    const sessionId = await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);

    assert.equal(await deleteSession(sessionId), true);

    assert.equal((await iterationsOfGame(db, gameId)).length, 1);
    assert.deepEqual(
      (await stateEventsOfGame(db, gameId)).map((event) => event.type),
      ['started'],
    );
  });
});
