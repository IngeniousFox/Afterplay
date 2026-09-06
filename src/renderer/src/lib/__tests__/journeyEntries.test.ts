// QUE BLINDA: que groupEntriesByYearMonth recorte el futuro (meses y anos
// enteros) y que buildEntries cocine bien las carataulas del Journey a partir
// de datos crudos — el filtro del papeleo del alta vs un evento de verdad, el
// gameId de una iteracion solo-horas-manuales, el reparto de un endless por
// mes con sus horas sueltas, y el orden final.
//
// QUE ES REAL Y QUE ES DOBLE: todo el input (games/sessions/stateEvents) son
// objetos literales a mano, no hace falta base de datos ni mocks — las dos
// funciones son puras.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseGame, baseSession, baseEvent, syntheticJourney } from './journeyFixtures';
import { buildEntries, groupEntriesByYearMonth, type JourneyEntry } from '../journeyEntries';

// Una entrada del viaje con lo minimo: la agrupacion solo mira lastAt, el
// resto viaja de paquete.
const entry = (key: string, lastAt: Date): JourneyEntry => ({
  key,
  kind: 'playthrough',
  iterationLabel: 'Playthrough 1',
  gameId: 1,
  title: 'A game',
  coverUrl: null,
  heroUrl: null,
  firstAt: lastAt,
  firstPrecision: 'day',
  lastAt,
  lastPrecision: 'day',
  hours: 3,
  sessions: [],
  note: null,
  state: null,
});

// El "ahora" fijo de todos los casos: 15 de junio de 2026.
const now = new Date(2026, 5, 15);

describe('groupEntriesByYearMonth', () => {
  it('agrupa por ano y mes de lastAt', () => {
    const grouped = groupEntriesByYearMonth(
      [
        entry('a', new Date(2026, 2, 4)),
        entry('b', new Date(2026, 2, 27)),
        entry('c', new Date(2024, 10, 1)),
      ],
      now,
    );
    assert.deepEqual([...grouped.keys()].sort(), [2024, 2026]);
    assert.deepEqual(
      grouped
        .get(2026)
        ?.get(2)
        ?.map((it) => it.key),
      ['a', 'b'],
    );
    assert.deepEqual(
      grouped
        .get(2024)
        ?.get(10)
        ?.map((it) => it.key),
      ['c'],
    );
  });

  it('deja fuera los meses que aun no han llegado del ano en curso', () => {
    const grouped = groupEntriesByYearMonth(
      [entry('junio', new Date(2026, 5, 1)), entry('agosto', new Date(2026, 7, 1))],
      now,
    );
    assert.deepEqual([...(grouped.get(2026)?.keys() ?? [])], [5]);
  });

  // La divergencia que trajo esta funcion: el escritorio recortaba solo los
  // meses del ano en curso, asi que un playthrough tecleado como 2027
  // (errata de 2017) encabezaba la linea temporal con un capitulo entero que
  // en el modo TV no existia.
  it('deja fuera los anos futuros ENTEROS, no solo sus meses', () => {
    const grouped = groupEntriesByYearMonth(
      [entry('errata', new Date(2027, 0, 9)), entry('real', new Date(2017, 0, 9))],
      now,
    );
    assert.equal(grouped.has(2027), false);
    assert.equal(grouped.get(2017)?.get(0)?.length, 1);
  });

  it('sin nada que ensenar devuelve un mapa vacio (no un ano vacio)', () => {
    const grouped = groupEntriesByYearMonth([entry('errata', new Date(2030, 3, 2))], now);
    assert.equal(grouped.size, 0);
  });
});

// ── buildEntries ─────────────────────────────────────────────────────────

describe('buildEntries', () => {
  it('indexa el archivo con un presupuesto lineal aunque haya muchos endless', () => {
    const { games, sessions, events } = syntheticJourney(120, 60);
    let gameIdReads = 0;
    const countedSessions = sessions.map((session) => ({
      ...session,
      get gameId(): number {
        gameIdReads++;
        return session.gameId;
      },
    }));
    const countedEvents = events.map((event) => ({
      ...event,
      get gameId(): number {
        gameIdReads++;
        return event.gameId;
      },
    }));
    const entries = buildEntries(games, countedSessions, countedEvents);
    assert.equal(
      entries.reduce((sum, item) => sum + item.hours, 0),
      120 * 66,
    );
    // El algoritmo anterior leía gameId > 450.000 veces. Este tope escala
    // con filas de entrada, sin depender de los ms de la máquina de CI.
    assert.ok(gameIdReads <= 5 * (sessions.length + events.length), `${gameIdReads} lecturas`);
  });

  it('conserva orden, referencias, empates de fecha y precisión sin mutar el archivo', () => {
    const at = new Date(2024, 2, 1);
    const first = Object.freeze(baseSession({ id: 1, startedAt: at, note: 'first' }));
    const second = Object.freeze(baseSession({ id: 2, startedAt: at, note: ' last ' }));
    const event = Object.freeze(baseEvent({ occurredAt: at, datePrecision: 'year' }));
    const sessions = [first, second];
    const events = [event];
    Object.freeze(sessions);
    Object.freeze(events);
    const [result] = buildEntries([baseGame()], sessions, events);
    assert.equal(result.firstPrecision, 'datetime');
    assert.equal(result.lastPrecision, 'year');
    assert.equal(result.note, 'last');
    assert.deepEqual(result.sessions, [first, second]);
    assert.equal(result.sessions[0], first);
    assert.notEqual(result.sessions, sessions);
    const grouped = groupEntriesByYearMonth([result, result], new Date(2025, 0, 1));
    assert.deepEqual(grouped.get(2024)?.get(2), [result, result]);
    assert.equal(grouped.get(2024)?.get(2)?.[0], result);
  });

  it('atribuye horas de endless al evento válido de SU vuelta, sin mezclar juegos', () => {
    const game = baseGame({
      endless: true,
      totalHours: 7,
      manualIterations: [
        { iterationId: 10, hours: 3, year: 2023 },
        { iterationId: 11, hours: 4, year: 2024 },
      ],
    });
    const events = [
      baseEvent({ iterationId: 10, occurredAt: new Date(2023, 4, 1) }),
      baseEvent({ iterationId: 11, occurredAt: new Date(2024, 7, 1) }),
      baseEvent({ iterationId: 11, type: 'plan_to_play', occurredAt: new Date(2025, 0, 1) }),
      baseEvent({ gameId: 2, iterationId: 20, occurredAt: new Date(2025, 2, 1) }),
    ];
    const entries = buildEntries([game, baseGame({ id: 2 })], [], events);
    assert.deepEqual(
      entries.filter((item) => item.gameId === 1).map((item) => [item.key, item.hours]),
      [
        ['endless:1:2024-7', 4],
        ['endless:1:2023-4', 3],
      ],
    );
  });

  it('descarta el evento pegado al alta como hito, pero cuenta uno fechado a mano', () => {
    const addedAt = new Date(2020, 0, 1, 10, 0, 0);
    const game = baseGame({ id: 1, addedAt });
    // A 2s del alta: dentro del margen de 5s de isAddedAtArtifact, es papeleo.
    const artifactEvent = baseEvent({
      id: 1,
      iterationId: 10,
      type: 'started',
      occurredAt: new Date(addedAt.getTime() + 2000),
    });
    const realEvent = baseEvent({
      id: 2,
      iterationId: 10,
      type: 'completed',
      occurredAt: new Date(2021, 5, 15),
      datePrecision: 'day',
    });
    const entries = buildEntries([game], [], [artifactEvent, realEvent]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].firstAt.getTime(), realEvent.occurredAt.getTime());
    assert.equal(entries[0].lastAt.getTime(), realEvent.occurredAt.getTime());
  });

  it('un evento plan_to_play nunca es hito del viaje, aunque no este pegado al alta', () => {
    const game = baseGame({ id: 1, addedAt: new Date(2020, 0, 1) });
    // Muy lejos del alta (2019 vs 2020): no lo filtra isAddedAtArtifact, solo
    // el que sea 'plan_to_play' puede sacarlo de la mezcla.
    const planEvent = baseEvent({
      id: 1,
      iterationId: 10,
      type: 'plan_to_play',
      occurredAt: new Date(2019, 0, 1),
    });
    const session = baseSession({ id: 1, iterationId: 10, startedAt: new Date(2021, 2, 1) });
    const entries = buildEntries([game], [session], [planEvent]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].firstAt.getTime(), session.startedAt.getTime());
  });

  it('una iteracion con horas manuales pero sin una sola sesion o evento propio se descarta (no hay de donde sacar el gameId)', () => {
    const game = baseGame({
      id: 1,
      manualIterations: [{ iterationId: 99, hours: 20, year: 2015 }],
    });
    const entries = buildEntries([game], [], []);
    assert.equal(entries.length, 0);
  });

  it('horas manuales sin ninguna fecha de verdad caen a mitad del ano que se les asigno', () => {
    // El plan_to_play no cuenta como hito (test de arriba) pero SI sirve para
    // sacar el gameId de la iteracion, que es lo unico que la deja entrar.
    const planEvent = baseEvent({ id: 1, iterationId: 10, type: 'plan_to_play' });
    const game = baseGame({
      id: 1,
      manualIterations: [{ iterationId: 10, hours: 15, year: 2015 }],
    });
    const entries = buildEntries([game], [], [planEvent]);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].firstAt, new Date(2015, 6, 1));
    assert.equal(entries[0].firstPrecision, 'year');
    assert.equal(entries[0].hours, 15);
  });

  it('la nota es la mas reciente CON TEXTO, saltando las sesiones sin nota', () => {
    const game = baseGame({ id: 1 });
    const s1 = baseSession({
      id: 1,
      iterationId: 10,
      startedAt: new Date(2021, 0, 1),
      note: 'donde lo deje la primera vez',
    });
    const s2 = baseSession({ id: 2, iterationId: 10, startedAt: new Date(2021, 0, 5), note: null });
    const s3 = baseSession({
      id: 3,
      iterationId: 10,
      startedAt: new Date(2021, 0, 10),
      note: '   ',
    });
    const entries = buildEntries([game], [s1, s2, s3], []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].note, 'donde lo deje la primera vez');
  });

  it('un endless se trocea por mes y las horas sin repartir van al mes MAS RECIENTE', () => {
    const game = baseGame({ id: 1, endless: true, totalHours: 10 });
    const marchSession = baseSession({
      id: 1,
      iterationId: 10,
      startedAt: new Date(2024, 2, 5),
      durationSec: 3600, // 1h medida
    });
    const octSession = baseSession({
      id: 2,
      iterationId: 10,
      startedAt: new Date(2024, 9, 5),
      durationSec: 3600 * 2, // 2h medidas
    });
    const entries = buildEntries([game], [marchSession, octSession], []);
    assert.equal(entries.length, 2);
    const march = entries.find((e) => e.key === 'endless:1:2024-2');
    const oct = entries.find((e) => e.key === 'endless:1:2024-9');
    assert.equal(march?.hours, 1);
    // totalHours(10) - asignadas(1+2=3) = 7 de sobra, todas a octubre por ser
    // el bucket mas reciente: 2 medidas + 7 sin repartir = 9.
    assert.equal(oct?.hours, 9);
  });

  it('un endless sin ninguna hora no genera ninguna entrada (no se abre un mes vacio porque si)', () => {
    const game = baseGame({ id: 1, endless: true, totalHours: 0 });
    const entries = buildEntries([game], [], []);
    assert.equal(entries.length, 0);
  });

  it('las entradas finales salen ordenadas de la mas reciente a la mas antigua', () => {
    const gameA = baseGame({ id: 1, title: 'A' });
    const gameB = baseGame({ id: 2, title: 'B' });
    const oldEvent = baseEvent({
      id: 1,
      gameId: 1,
      iterationId: 10,
      type: 'completed',
      occurredAt: new Date(2019, 0, 1),
      datePrecision: 'day',
    });
    const newEvent = baseEvent({
      id: 2,
      gameId: 2,
      iterationId: 20,
      type: 'completed',
      occurredAt: new Date(2023, 0, 1),
      datePrecision: 'day',
    });
    const entries = buildEntries([gameA, gameB], [], [oldEvent, newEvent]);
    assert.deepEqual(
      entries.map((e) => e.gameId),
      [2, 1],
    );
  });
});
