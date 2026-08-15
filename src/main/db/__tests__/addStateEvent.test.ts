import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import type { Session, StateEvent } from '../../../shared/types';
import { sessionsTable, stateEventsTable } from '../schema';
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

// addStateEvent es la puerta ÚNICA por la que pasa cualquier cambio de estado
// —menú Status, Edit, alta de un juego, watcher— y hace tres cosas en la misma
// transacción: pausa a los hermanos, apila el evento y cierra la sesión que
// estuviera viva. Los tres tramos tienen invariantes que no se ven en pantalla
// hasta que ya están rotos, y ninguno vive en la UI:
//
//   · SPEC 4.5: como mucho UN playthrough activo por juego.
//   · Un hito con fecha del pasado NO puede tirar a la basura las horas de la
//     sesión que sigue corriendo ahora mismo.
//   · El evento, la pausa del hermano y el cierre de la sesión comparten un
//     único instante, no tres `new Date()` con milisegundos distintos.
//
// Todo con la base real del andamio: lo que importa aquí no es la consulta que
// se escribió, es el ESTADO DERIVADO que sale por getGameById después — que es
// lo único que ve quien mira la ficha.

let db: TestDb;
let addStateEvent: typeof import('../queries/stateEvents/addStateEvent').addStateEvent;
let getGameById: typeof import('../queries/games/getGameById').getGameById;

before(async () => {
  // Dentro del before a propósito: el mock.module del andamio tiene que estar
  // registrado ANTES de que estos módulos resuelvan su getDb().
  ({ addStateEvent } = await import('../queries/stateEvents/addStateEvent'));
  ({ getGameById } = await import('../queries/games/getGameById'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ── Fábricas locales ───────────────────────────────────────────────────────

type Hermanos = { gameId: number; primero: number; segundo: number };

// Un juego con dos playthroughs: el escenario mínimo de la auto-pausa.
const juegoConDosPlaythroughs = async (endless = false): Promise<Hermanos> => {
  const gameId = await makeGame(db, { title: 'Hollow Knight', endless });
  const primero = await makeIteration(db, gameId, { label: 'Playthrough 1' });
  const segundo = await makeIteration(db, gameId, { label: 'Playthrough 2' });
  return { gameId, primero, segundo };
};

// El log de un playthrough en orden de escritura (por id, no por fecha): la
// auto-pausa se reconoce por ser la ÚLTIMA fila insertada, aunque comparta
// instante con las anteriores.
const eventosDe = async (iterationId: number): Promise<StateEvent[]> =>
  db
    .select()
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iterationId))
    .orderBy(asc(stateEventsTable.id));

const sesion = async (id: number): Promise<Session> => {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  return row;
};

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

describe('addStateEvent — SPEC 4.5: como mucho un playthrough activo por juego', () => {
  it('empezar un playthrough pausa al hermano que seguía en marcha', async () => {
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-01-10T18:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const log = await eventosDe(primero);
    assert.equal(log.length, 2);
    assert.equal(log[1].type, 'on_hold');
    // La pausa nace en el instante del started que la provoca, no "ahora": si
    // se fechara por su cuenta, el Journey enseñaría la pausa un día distinto
    // del arranque que la causó.
    assert.equal(iso(log[1].occurredAt), '2026-03-01T20:00:00.000Z');
    assert.equal(log[1].note, 'Pausado automáticamente al empezar otro playthrough.');

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'on_hold');
    assert.equal(detalle?.iterations[1].currentState, 'started');
    // El invariante, dicho tal cual: uno y solo uno activo.
    assert.equal(detalle?.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('un hermano que ya no estaba activo no recibe una pausa de más', async () => {
    // Cuatro finales distintos: ninguno es 'started', así que ninguno se
    // pausa. Sin la comprobación, cada nuevo playthrough iría apilando un
    // on_hold encima de playthroughs terminados hace años y el historial se
    // llenaría de pausas que nadie hizo.
    for (const estado of ['completed', 'dropped', 'on_hold', 'resting'] as const) {
      db = await freshDb();
      const { primero, segundo } = await juegoConDosPlaythroughs();
      await makeStateEvent(db, primero, 'started', '2026-01-10T18:00:00Z');
      await makeStateEvent(db, primero, estado, '2026-02-01T18:00:00Z');

      await addStateEvent({
        iterationId: segundo,
        type: 'started',
        occurredAt: new Date('2026-03-01T20:00:00Z'),
        datePrecision: 'datetime',
        note: null,
      });

      const log = await eventosDe(primero);
      assert.equal(log.length, 2, `un hermano en ${estado} no debe recibir pausa`);
    }
  });

  it('registrar un playthrough viejo no pausa el que está en marcha hoy', async () => {
    // El caso real: estás jugando (Playthrough 1 activo) y te acuerdas de
    // apuntar la partida de 2019 desde "+ Add manual" del Edit. Ese alta
    // escribe un 'started' con fecha 2019 — que no puede pausar nada del
    // presente, porque no pasó nada en el presente.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-08-01T19:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2019-06-01T00:00:00Z'),
      datePrecision: 'year',
      note: null,
    });
    await addStateEvent({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2019-09-01T00:00:00Z'),
      datePrecision: 'year',
      note: null,
    });

    assert.equal((await eventosDe(primero)).length, 1);
    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'started');
    assert.equal(detalle?.iterations[1].currentState, 'completed');
    // Y el juego se sigue leyendo Playing: el evento más reciente del log
    // entero es el arranque de 2026, no el desenlace de 2019.
    assert.equal(detalle?.currentState, 'started');
  });

  it('el plan_to_play del hermano no lo disfraza de inactivo', async () => {
    // LA CICATRIZ del filtro de 'plan_to_play' (addStateEvent.ts:69-74). Un
    // juego promovido desde el Plan conserva su 'plan_to_play' —fechado
    // cuando lo planeaste— y encima recibe un 'started' RETROACTIVO del alta:
    // el último evento por fecha es el plan, no el arranque. Sin ignorar el
    // plan, este hermano parecía "no activo", la pausa no saltaba y el juego
    // se quedaba con dos playthroughs activos mientras el resto de la app
    // (getGames, getGameById) lo pintaba Playing.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-01-05T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeStateEvent(db, primero, 'plan_to_play', '2026-07-20T09:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-01T21:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const log = await eventosDe(primero);
    assert.equal(log.length, 3);
    assert.equal(log[2].type, 'on_hold');

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('un hermano cuyo único rastro es el plan_to_play se queda como está', async () => {
    // La otra cara del mismo filtro: planear no es jugar. Un playthrough con
    // solo el plan encima no está activo, así que no hay nada que pausar — y
    // meterle un on_hold le inventaría un estado que nunca tuvo.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'plan_to_play', '2026-07-20T09:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-01T21:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    assert.equal((await eventosDe(primero)).length, 1);
    const detalle = await getGameById(gameId);
    // 'plan_to_play' no es estado: el playthrough sigue leyéndose Unplayed.
    assert.equal(detalle?.iterations[0].currentState, null);
  });

  it('en un juego endless la pausa habla su vocabulario: resting, no on_hold', async () => {
    // Un endless no tiene playthroughs discretos y su selector solo ofrece
    // [playing, resting, dropped] (SPEC 4.5). Si aquí cayera un 'on_hold', el
    // juego mostraría un estado que su propia UI no sabe ni elegir. Los dos
    // contenedores existen porque convertir un juego normal a endless los
    // conserva todos.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs(true);
    await makeStateEvent(db, primero, 'started', '2026-01-10T18:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const log = await eventosDe(primero);
    assert.equal(log[1].type, 'resting');
    assert.equal(log[1].note, 'Puesto a descansar automáticamente.');

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'resting');
  });

  it('si el historial venía con dos activos, el nuevo started los pausa a los dos', async () => {
    // Datos heredados de antes de que la regla viviera aquí (o escritos por
    // una ruta que se saltó addStateEvent). La auto-pausa recorre TODOS los
    // hermanos, no solo el primero que encuentra: si se quedara en uno, el
    // invariante se arreglaría a medias y el juego seguiría con dos activos.
    const gameId = await makeGame(db, { title: 'Nier Automata' });
    const a = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const b = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    const c = await makeIteration(db, gameId, { label: 'Playthrough 3' });
    await makeStateEvent(db, a, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, b, 'started', '2026-02-10T18:00:00Z');

    await addStateEvent({
      iterationId: c,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    assert.equal((await eventosDe(a))[1].type, 'on_hold');
    assert.equal((await eventosDe(b))[1].type, 'on_hold');
    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('solo un started pausa: cualquier otro hito deja a los hermanos en paz', async () => {
    // Terminar el Playthrough 2 no dice nada del Playthrough 1. Si la pausa
    // se disparara con cualquier evento, corregir una fecha vieja desde el
    // Edit apagaría el playthrough que estás jugando ahora.
    const { primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-01-10T18:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    assert.equal((await eventosDe(primero)).length, 1);
  });

  it('un started en el mismo instante que el último evento del hermano sí lo pausa, y el juego se sigue leyendo Playing', async () => {
    // Dos bordes en el mismo caso, y los dos se ven en pantalla:
    //
    //   1. El corte es `<=`, no `<`: dos eventos con el MISMO instante (dos
    //      clics seguidos, o dos fechas de día que caen las dos a medianoche)
    //      tienen que pausar igual. Con `<` el hermano se quedaba activo.
    //   2. Empatados en fecha, latestRealStateEvent desempata por id — y la
    //      pausa se inserta ANTES que el evento nuevo. Por eso el hermano lee
    //      'on_hold' (su pausa tiene id mayor que su started) y el JUEGO lee
    //      'started' (el evento nuevo es el id más alto de los tres). Si un
    //      refactor invirtiera el orden de los dos INSERTs, la ficha diría
    //      "On Hold" justo después de pulsar Play.
    const instante = '2026-05-05T12:00:00Z';
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', instante);

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date(instante),
      datePrecision: 'datetime',
      note: null,
    });

    const log = await eventosDe(primero);
    assert.equal(log.length, 2);
    assert.equal(log[1].type, 'on_hold');

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'on_hold');
    assert.equal(detalle?.iterations[1].currentState, 'started');
    assert.equal(detalle?.currentState, 'started');
  });
});

describe('addStateEvent — el hito terminal y la sesión que sigue viva', () => {
  it('terminar con el juego en marcha cierra la sesión en el instante del hito', async () => {
    // Sin esto, las horas de la tarde en que te lo pasaste se quedan sin
    // contar (durationSec null mientras la sesión está abierta) hasta que el
    // watcher note el cierre real del proceso — que puede ser horas después,
    // o nunca si cierras la app antes.
    const gameId = await makeGame(db, { title: 'Celeste' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-08-13T10:00:00Z');
    const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:30:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const cerrada = await sesion(sessionId);
    assert.equal(iso(cerrada.endedAt), '2026-08-13T12:30:00.000Z');
    assert.equal(cerrada.durationSec, 9000);

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.isLive, false);
    assert.equal(detalle?.totalHours, 2.5);
  });

  it('un hito fechado ANTES del arranque de la sesión viva no la toca', async () => {
    // LA CICATRIZ de addStateEvent.ts:131-142. Pasas a Beaten con la fecha
    // real en que lo terminaste (una semana atrás) mientras el juego SIGUE
    // corriendo: cerrar la sesión ahí la dejaba con endedAt anterior a su
    // propio startedAt y durationSec 0 —computeDurationSec hace Math.max(0,…)
    // pensando en un reloj raro—, o sea las horas medidas de hoy a la basura.
    // Y sin arreglo posible: closeSession es idempotente, así que el watcher
    // la vería ya cerrada y la dejaría tal cual.
    const gameId = await makeGame(db, { title: 'Elden Ring' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-07-01T18:00:00Z');
    const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-06T00:00:00Z'),
      datePrecision: 'day',
      note: null,
    });

    const viva = await sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);

    // El evento sí se apila: es una corrección del historial, y el estado
    // derivado la refleja. Lo que no hace es tocar la sesión de hoy.
    const detalle = await getGameById(gameId);
    assert.equal(detalle?.currentState, 'completed');
    assert.equal(detalle?.isLive, true);
  });

  it('marcar Beaten "hoy" con precisión de día cae a medianoche y por eso no cierra la sesión de esta tarde', async () => {
    // El mismo guardián, pero en el caso que pasa de verdad todos los días:
    // el picker de "Finished / left" guarda las fechas de día a medianoche
    // (parseIsoDate → 'YYYY-MM-DDT00:00:00'), así que el hito de HOY cae
    // ANTES de la sesión que empezó esta tarde. La sesión se queda abierta y
    // la cierra el watcher cuando muera el proceso, con su duración real.
    const gameId = await makeGame(db, { title: 'Outer Wilds' });
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T16:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-13T00:00:00Z'),
      datePrecision: 'day',
      note: null,
    });

    const viva = await sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
  });

  it('un hito exactamente en el arranque de la sesión sí la cierra, con duración cero', async () => {
    // El borde justo del guardián anterior: la condición es `>=`, no `>`.
    // Importa que quede fijado hacia qué lado cae — con `>` una sesión que
    // arranca y termina en el mismo instante (arrancas el juego y lo cierras
    // acto seguido marcándolo Dropped) se quedaría abierta para siempre.
    //
    // Este borde estuvo un tiempo marcado como sospecha porque la cabecera de
    // closeOpenSessionsAt decía "solo si el hito cae DESPUÉS del inicio"
    // mientras el código comparaba con `>=`. El comportamiento no era el fallo,
    // lo era la palabra: se corrigió el comentario (una sesión de 0 s es dato
    // bueno; una abierta para siempre no lo es, porque el watcher ya no está
    // para cerrarla y el dedup por juego de startGameSession se queda pillado).
    const gameId = await makeGame(db, { title: 'Katana Zero' });
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'dropped',
      occurredAt: new Date('2026-08-13T10:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const cerrada = await sesion(sessionId);
    assert.equal(iso(cerrada.endedAt), '2026-08-13T10:00:00.000Z');
    assert.equal(cerrada.durationSec, 0);
  });

  it('cierran la sesión los cuatro estados de closesOpenSession, y solo esos', async () => {
    // La misma regla vive en shared/playthroughState (CLOSES_OPEN_SESSION) y
    // se aplica aquí: si alguien añade un estado al enum y se olvida del
    // conjunto, o al revés, esto lo canta. 'resting' entra porque un endless
    // que descansa tampoco se sigue jugando; 'started' no, porque empezar no
    // termina nada; 'plan_to_play' no, porque no es ni un estado.
    const casos = [
      { type: 'completed', cierra: true },
      { type: 'dropped', cierra: true },
      { type: 'on_hold', cierra: true },
      { type: 'resting', cierra: true },
      { type: 'started', cierra: false },
      { type: 'plan_to_play', cierra: false },
    ] as const;

    for (const caso of casos) {
      db = await freshDb();
      const gameId = await makeGame(db, { title: 'Stardew Valley' });
      const iterationId = await makeIteration(db, gameId);
      const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');

      await addStateEvent({
        iterationId,
        type: caso.type,
        occurredAt: new Date('2026-08-13T11:00:00Z'),
        datePrecision: 'datetime',
        note: null,
      });

      const fila = await sesion(sessionId);
      assert.equal(
        fila.endedAt !== null,
        caso.cierra,
        `${caso.type} ${caso.cierra ? 'debería' : 'no debería'} cerrar la sesión abierta`,
      );
      assert.equal(fila.durationSec, caso.cierra ? 3600 : null);
    }
  });

  it('una sesión ya cerrada no se recalcula ni se cuenta dos veces', async () => {
    // El filtro es isNull(endedAt): un hito posterior a una sesión que ya
    // terminó no la puede estirar hasta su fecha. Sin esa guarda, marcar
    // Beaten por la noche una partida de la mañana convertía dos horas
    // medidas en las que fueran hasta el momento del clic.
    const gameId = await makeGame(db, { title: 'Tunic' });
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeSession(db, iterationId, '2026-08-13T10:00:00Z', 2);

    await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-13T23:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const fila = await sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(fila.durationSec, 7200);
    assert.equal((await getGameById(gameId))?.totalHours, 2);
  });

  it('si el playthrough tenía DOS sesiones abiertas, el hito las cierra las dos', async () => {
    // ARREGLADO: la búsqueda era `.limit(1)` sin ORDER BY, o sea una fila al
    // azar del plan de SQLite. Un playthrough sí puede acabar con dos sesiones
    // vivas —assignSession engancha una sesión de emulador pendiente a una
    // iteración que ya tenía la del watcher—, y entonces el hito terminal
    // cerraba una y dejaba la otra colgando para siempre: isLive true en un
    // juego marcado Beaten, y el dedup por JUEGO de startGameSession
    // impidiendo abrir la siguiente sesión mientras esa fantasma siguiera ahí.
    // Ahora se recorren todas las abiertas.
    const gameId = await makeGame(db, { title: 'Chrono Trigger' });
    const iterationId = await makeIteration(db, gameId);
    const watcher = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');
    const emulador = await makeOpenSession(db, iterationId, '2026-08-13T11:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const primera = await sesion(watcher);
    assert.equal(iso(primera.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(primera.durationSec, 7200);
    const segunda = await sesion(emulador);
    assert.equal(iso(segunda.endedAt), '2026-08-13T12:00:00.000Z');
    // Cada una con SU duración: el cierre comparte el instante final, no el
    // arranque. Si el arreglo hubiera reusado el startedAt de la primera fila,
    // esta contaría 2 h que nadie jugó.
    assert.equal(segunda.durationSec, 3600);

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.isLive, false);
    assert.equal(detalle?.totalHours, 3);
  });

  it('con dos sesiones abiertas, la que empezó DESPUÉS del hito se queda viva y la otra no', async () => {
    // La guarda de la fecha se evalúa POR SESIÓN, no contra una fila elegida
    // al azar. Antes, con `.limit(1)`, este caso salía a cara o cruz: si el
    // plan devolvía la sesión de las 14:00, el hito de las 12:00 caía antes de
    // su arranque, la función se iba de vacío y NINGUNA de las dos se cerraba.
    const gameId = await makeGame(db, { title: 'Metroid Dread' });
    const iterationId = await makeIteration(db, gameId);
    const vieja = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');
    const posterior = await makeOpenSession(db, iterationId, '2026-08-13T14:00:00Z');

    await addStateEvent({
      iterationId,
      type: 'dropped',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const cerrada = await sesion(vieja);
    assert.equal(iso(cerrada.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(cerrada.durationSec, 7200);

    // La de las 14:00 sigue abierta: cerrarla con las 12:00 le dejaría un
    // endedAt anterior a su propio startedAt y durationSec 0 (el Math.max(0)
    // de computeDurationSec), que es el dato imposible que la guarda existe
    // para evitar. Esa la cierra el watcher cuando muera el proceso.
    const viva = await sesion(posterior);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
    assert.equal((await getGameById(gameId))?.isLive, true);
  });

  it('al pausar al hermano tambien se le cierran sus DOS sesiones abiertas', async () => {
    // El mismo arreglo por la otra puerta: la pausa automática del tramo 1
    // pasa por la misma función, así que el hermano no puede quedarse con una
    // sesión viva "de propina" mientras la ficha lo pinta On Hold.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-08-13T09:00:00Z');
    const una = await makeOpenSession(db, primero, '2026-08-13T09:30:00Z');
    const otra = await makeOpenSession(db, primero, '2026-08-13T10:30:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    assert.equal((await sesion(una)).durationSec, 9000);
    assert.equal((await sesion(otra)).durationSec, 5400);
    assert.equal((await getGameById(gameId))?.isLive, false);
  });

  it('el hito solo cierra la sesión de SU playthrough, no la del hermano', async () => {
    // La búsqueda de sesión abierta filtra por iterationId, no por juego.
    // Terminar el Playthrough 2 no puede cerrar —ni robarle las horas a— una
    // sesión que cuelga del Playthrough 1.
    const { primero, segundo } = await juegoConDosPlaythroughs();
    const sessionId = await makeOpenSession(db, primero, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const viva = await sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
  });

  it('al pausar al hermano tambien se le cierra la sesion que tenia viva', async () => {
    // El cierre se decidia con closesOpenSession(input.type) —aqui 'started'—,
    // asi que el 'on_hold' que esta misma funcion acaba de escribir en el
    // hermano no pasaba por ese tramo, pese a estar en CLOSES_OPEN_SESSION.
    // Quedaba un playthrough 'pausado' con una sesion viva colgando e isLive
    // true; y por el dedup por JUEGO de startGameSession, el watcher no podia
    // abrir una sesion nueva para el playthrough que SI estas jugando.
    //
    // La sesion se cierra en el instante de la pausa: dos horas desde las
    // 10:00 hasta el 'started' del hermano a las 12:00.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-08-13T09:00:00Z');
    const sessionId = await makeOpenSession(db, primero, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'on_hold');
    assert.equal(detalle?.isLive, false);

    const viva = await sesion(sessionId);
    assert.equal(viva.endedAt?.toISOString(), '2026-08-13T12:00:00.000Z');
    assert.equal(viva.durationSec, 7200);
  });

  it('una pausa fechada ANTES del inicio de la sesion viva la deja abierta', async () => {
    // La misma guarda que protege al evento principal, ahora tambien aqui: un
    // 'started' retroactivo en el hermano no puede cerrar con endedAt anterior
    // al startedAt y mandar las horas de esa tarde a la basura.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-08-10T09:00:00Z');
    const sessionId = await makeOpenSession(db, primero, '2026-08-13T10:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T08:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const viva = await sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal((await getGameById(gameId))?.isLive, true);
  });
});

describe('addStateEvent — la fecha y su precisión', () => {
  it('la precisión llega al log tal cual, sin normalizar', async () => {
    // La precisión NO es decorado: format.ts la mira para decidir si enseña
    // "2019", "Jun 2019" o el día con hora. Guardar 'datetime' por defecto en
    // una fecha que el usuario tecleó como año le inventaría una exactitud
    // que nunca dio.
    const gameId = await makeGame(db, { title: 'Ico' });
    const iterationId = await makeIteration(db, gameId);

    for (const precision of ['year', 'month', 'day', 'datetime'] as const) {
      const evento = await addStateEvent({
        iterationId,
        type: 'started',
        occurredAt: new Date('2019-06-01T00:00:00Z'),
        datePrecision: precision,
        note: null,
      });
      assert.equal(evento.datePrecision, precision);
    }
  });

  it('la pausa automática hereda el instante y la precisión del started que la provoca', async () => {
    // Apuntas hoy una partida de 2024 con precisión de año mientras otro
    // playthrough sigue activo desde 2023. La pausa que se le escribe tiene
    // que hablar con la MISMA precisión que la fecha que la causó: marcarla
    // 'datetime' pintaría en el Journey un "On Hold el 1 de enero de 2024 a
    // las 00:00" que nadie escribió nunca.
    const { primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2023-04-01T00:00:00Z', {
      datePrecision: 'year',
    });

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2024-01-01T00:00:00Z'),
      datePrecision: 'year',
      note: null,
    });

    const pausa = (await eventosDe(primero))[1];
    assert.equal(pausa.type, 'on_hold');
    assert.equal(pausa.datePrecision, 'year');
    assert.equal(iso(pausa.occurredAt), '2024-01-01T00:00:00.000Z');
  });

  it('sin occurredAt, el evento y la pausa del hermano caen en el MISMO instante', async () => {
    // El menú Status no manda fecha: la pone addStateEvent, UNA vez, y la
    // reparte. Si cada INSERT llamara a su propio new Date(), el evento y la
    // pausa quedarían con milisegundos distintos — y entonces el desempate
    // por fecha de latestRealStateEvent decidiría en lugar del desempate por
    // id, que es el que hace que el juego siga leyéndose Playing.
    // Se comparan entre sí y no contra un reloj fijo a propósito: lo que se
    // prueba es que hay un único instante, no cuál es.
    const { primero, segundo } = await juegoConDosPlaythroughs();
    // Fecha absurdamente vieja a propósito: la pausa solo salta si el hermano
    // es anterior al "ahora", y ese "ahora" lo pone el reloj de la máquina.
    // Con el año 2000 el test da igual el día que se ejecute.
    await makeStateEvent(db, primero, 'started', '2000-01-01T00:00:00Z');

    const evento = await addStateEvent({
      iterationId: segundo,
      type: 'started',
      datePrecision: 'datetime',
      note: null,
    });

    const pausa = (await eventosDe(primero))[1];
    assert.equal(pausa.type, 'on_hold');
    assert.equal(pausa.occurredAt.getTime(), evento.occurredAt.getTime());
  });

  it('sin occurredAt, la sesión se cierra exactamente en el instante del evento', async () => {
    // El otro reparto del mismo instante. Una sesión cuyo endedAt no coincide
    // con el hito que la cerró deja un hueco de horas sin dueño entre los dos.
    const gameId = await makeGame(db, { title: 'Dead Cells' });
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2000-01-01T00:00:00Z');

    const evento = await addStateEvent({
      iterationId,
      type: 'dropped',
      datePrecision: 'datetime',
      note: null,
    });

    const cerrada = await sesion(sessionId);
    assert.equal(cerrada.endedAt?.getTime(), evento.occurredAt.getTime());
  });

  it('el instante se guarda al milisegundo aunque la duración se redondee al segundo', async () => {
    // endedAt sale del hito y durationSec de computeDurationSec: son dos
    // datos, no uno derivado del otro. Si un refactor calculara endedAt como
    // startedAt + durationSec, este medio segundo se perdería y las dos
    // columnas dejarían de cuadrar.
    const gameId = await makeGame(db, { title: 'Vampire Survivors' });
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeOpenSession(db, iterationId, '2026-08-13T10:00:00.000Z');

    await addStateEvent({
      iterationId,
      type: 'resting',
      occurredAt: new Date('2026-08-13T10:00:01.500Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const cerrada = await sesion(sessionId);
    assert.equal(iso(cerrada.endedAt), '2026-08-13T10:00:01.500Z');
    assert.equal(cerrada.durationSec, 2);
  });
});

describe('addStateEvent — el estado derivado que queda después', () => {
  it('la fecha de fin del playthrough es la del hito, no la de la sesión que cerró', async () => {
    // Modelo v2: no hay ancla endSessionId, el "fin" se deriva del último
    // evento con fecha de salida. Aquí los dos instantes coinciden porque el
    // hito cerró la sesión, pero el que manda es el evento — y el endEvent
    // que enseña el Edit tiene que apuntar a ÉL para poder corregirlo.
    const gameId = await makeGame(db, { title: 'Inside' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-08-13T10:00:00Z');
    await makeOpenSession(db, iterationId, '2026-08-13T10:00:00Z');

    const evento = await addStateEvent({
      iterationId,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:30:00Z'),
      datePrecision: 'datetime',
      note: 'Final bueno',
    });

    const iteracion = (await getGameById(gameId))?.iterations[0];
    assert.equal(iso(iteracion?.endedAt ?? null), '2026-08-13T12:30:00.000Z');
    assert.equal(iteracion?.endEvent?.id, evento.id);
    assert.equal(iso(iteracion?.startedAt ?? null), '2026-08-13T10:00:00.000Z');
  });

  it('retomar un playthrough pausado le quita la fecha de fin y devuelve la pausa al otro', async () => {
    // El ida y vuelta completo, que es donde un refactor deja restos: el que
    // se retoma pierde su endedAt (leavesEndDate solo cuenta si es el ÚLTIMO
    // estado, un on_hold viejo no deja "fin"), el otro se pausa, y en ningún
    // momento hay dos activos.
    const { gameId, primero, segundo } = await juegoConDosPlaythroughs();
    await makeStateEvent(db, primero, 'started', '2026-01-10T18:00:00Z');

    await addStateEvent({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });
    await addStateEvent({
      iterationId: primero,
      type: 'started',
      occurredAt: new Date('2026-06-01T20:00:00Z'),
      datePrecision: 'datetime',
      note: null,
    });

    const detalle = await getGameById(gameId);
    assert.equal(detalle?.iterations[0].currentState, 'started');
    assert.equal(detalle?.iterations[0].endedAt, null);
    assert.equal(detalle?.iterations[1].currentState, 'on_hold');
    assert.equal(iso(detalle?.iterations[1].endedAt ?? null), '2026-06-01T20:00:00.000Z');
    assert.equal(detalle?.iterations.filter((it) => it.currentState === 'started').length, 1);
    assert.equal(detalle?.currentState, 'started');
  });
});
