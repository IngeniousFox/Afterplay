import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { count } from '../../../__tests__/helpers';
import type { StateEvent } from '../../../../../../shared/dto';
import { sessions, stateEvents, type SessionRow, type StateEventRow } from '../../../schema';
import { alive, isStoreError } from '../../../store';
import {
  LOCAL,
  T0,
  asOtherDevice,
  at,
  day,
  insertSynced,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { addStateEvent } from '../stateEvents';
import type { AddStateEventInput } from '../../../../../../shared/dto';
import { derivedDetail } from './detail';

// addStateEvent sobre el esquema 2.0. Porta, caso por caso, los de
// src/main/db/__tests__/addStateEvent.test.ts (la especificación de la 1.x):
// la auto-pausa de hermanos ("como mucho un playthrough activo"), el cierre de
// la sesión que sigue viva y el instante único compartido. Como allí, lo que se
// comprueba es el ESTADO DERIVADO que queda (`derivedDetail` aplica la misma
// regla compartida que la ficha), no solo la fila escrita.
//
// Cambios del 2.0 que se prueban aparte, al final:
// - `plan_to_play` ya no es un tipo válido (los dos casos 1.x de su "cicatriz"
//   se reescriben con el Plan en `plan_entries`);
// - `datePrecision = 'unknown'` (R-07);
// - solo se cierran las sesiones PROPIAS, con `closedBy = 'user'` (R-10, R-12);
// - `deviceId` del evento = este dispositivo; errores con código estable.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

// ── Fábricas locales ───────────────────────────────────────────────────────

type Hermanos = { gameId: string; primero: string; segundo: string };

const juegoConDosPlaythroughs = (endless = false): Hermanos => {
  const gameId = seedGame(fx.ctx, { title: 'Hollow Knight', endless });
  const primero = seedPlaythrough(fx.ctx, { gameId });
  const segundo = seedPlaythrough(fx.ctx, { gameId });
  return { gameId, primero, segundo };
};

const juegoConUno = (title: string): { gameId: string; pt: string } => {
  const gameId = seedGame(fx.ctx, { title });
  return { gameId, pt: seedPlaythrough(fx.ctx, { gameId }) };
};

const evento = (
  playthroughId: string,
  type: AddStateEventInput<string>['type'],
  occurredAt: string,
  datePrecision: AddStateEventInput<string>['datePrecision'] = 'datetime',
): string =>
  seedStateEvent(fx.ctx, { playthroughId, type, occurredAt: new Date(occurredAt), datePrecision });

const add = (
  input: Omit<AddStateEventInput<string>, 'note'> & { note?: string | null },
): StateEvent<string> => addStateEvent(fx.ctx, { note: null, ...input });

// El log vivo de un playthrough en orden de CREACIÓN: la auto-pausa se
// reconoce por ser la última fila creada aunque comparta instante.
const eventosDe = (playthroughId: string): StateEventRow[] =>
  fx.ctx.db
    .select()
    .from(stateEvents)
    .where(and(eq(stateEvents.playthroughId, playthroughId), alive(stateEvents)))
    .orderBy(asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all();

const sesion = (id: string): SessionRow => {
  const row = fx.ctx.db.select().from(sessions).where(eq(sessions.id, id)).get();
  assert.ok(row, `la sesión ${id} existe`);
  return row;
};

// Una sesión abierta de ESTE PC. La puerta solo deja una abierta por
// playthrough y dispositivo (§7.7); la segunda llega "por sync" (como la de un
// emulador asignada al mismo playthrough), que es el caso real de la 1.x.
const abierta = (playthroughId: string, startedAt: string): string => {
  const start = new Date(startedAt);
  const yaAbierta = fx.ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.playthroughId, playthroughId),
        eq(sessions.deviceId, LOCAL),
        isNull(sessions.endedAt),
      ),
    )
    .get();
  if (!yaAbierta) return seedSession(fx.ctx, { playthroughId, startedAt: start, endedAt: null });
  return insertSynced(fx.ctx, 'sessions', {
    playthroughId,
    deviceId: LOCAL,
    startedBy: 'watcher',
    source: 'measured',
    startedAt: start,
    endedAt: null,
    durationSec: null,
    datePrecision: 'datetime',
    lastSeenAt: start,
  });
};

const cerrada = (playthroughId: string, startedAt: string, horas: number): string => {
  const start = new Date(startedAt);
  return seedSession(fx.ctx, {
    playthroughId,
    startedAt: start,
    endedAt: new Date(start.getTime() + horas * 3_600_000),
  });
};

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

// ══ Portados de la 1.x ══════════════════════════════════════════════════════

describe('addStateEvent — SPEC 4.5: como mucho un playthrough activo por juego', () => {
  it('empezar un playthrough pausa al hermano que seguía en marcha', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    const log = eventosDe(primero);
    assert.equal(log.length, 2);
    assert.equal(log[1].type, 'on_hold');
    // La pausa nace en el instante del started que la provoca, no "ahora".
    assert.equal(iso(log[1].occurredAt), '2026-03-01T20:00:00.000Z');
    assert.equal(log[1].note, 'Pausado automáticamente al empezar otro playthrough.');

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations[0].currentState, 'on_hold');
    assert.equal(detalle.iterations[1].currentState, 'started');
    assert.equal(detalle.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('un hermano que ya no estaba activo no recibe una pausa de más', () => {
    for (const estado of ['completed', 'dropped', 'on_hold', 'resting'] as const) {
      const { primero, segundo } = juegoConDosPlaythroughs();
      evento(primero, 'started', '2026-01-10T18:00:00Z');
      evento(primero, estado, '2026-02-01T18:00:00Z');

      add({
        iterationId: segundo,
        type: 'started',
        occurredAt: new Date('2026-03-01T20:00:00Z'),
        datePrecision: 'datetime',
      });

      assert.equal(eventosDe(primero).length, 2, `un hermano en ${estado} no debe recibir pausa`);
    }
  });

  it('registrar un playthrough viejo no pausa el que está en marcha hoy', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-08-01T19:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2019-06-01T00:00:00Z'),
      datePrecision: 'year',
    });
    add({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2019-09-01T00:00:00Z'),
      datePrecision: 'year',
    });

    assert.equal(eventosDe(primero).length, 1);
    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations[0].currentState, 'started');
    assert.equal(detalle.iterations[1].currentState, 'completed');
    assert.equal(detalle.currentState, 'started');
  });

  it('[2.0] un juego que pasó por el Plan no tiene plan_to_play que disfrace al hermano: se pausa', () => {
    // Era la cicatriz del filtro de 'plan_to_play' en la 1.x. En 2.0 el paso
    // por el Plan vive en `plan_entries` (aquí, viva) y no en el log, así que
    // el último estado real del hermano es su started y la pausa salta.
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    fx.ctx.store.create('plan_entries', { gameId, plannedAt: new Date('2026-07-20T09:00:00Z') });
    evento(primero, 'started', '2026-01-05T00:00:00Z', 'day');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-01T21:00:00Z'),
      datePrecision: 'datetime',
    });

    const log = eventosDe(primero);
    assert.equal(log.length, 2);
    assert.equal(log[1].type, 'on_hold');
    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('[2.0] un hermano sin ningún evento (recién creado o solo planeado) se queda como está', () => {
    // La otra cara: planear no es jugar. Sin eventos no hay estado activo.
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-01T21:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(eventosDe(primero).length, 0);
    assert.equal(derivedDetail(fx.ctx, gameId).iterations[0].currentState, null);
  });

  it('en un juego endless la pausa habla su vocabulario: resting, no on_hold', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs(true);
    evento(primero, 'started', '2026-01-10T18:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    const log = eventosDe(primero);
    assert.equal(log[1].type, 'resting');
    assert.equal(log[1].note, 'Puesto a descansar automáticamente.');
    assert.equal(derivedDetail(fx.ctx, gameId).iterations[0].currentState, 'resting');
  });

  it('si el historial venía con dos activos, el nuevo started los pausa a los dos', () => {
    const gameId = seedGame(fx.ctx, { title: 'Nier Automata' });
    const a = seedPlaythrough(fx.ctx, { gameId });
    const b = seedPlaythrough(fx.ctx, { gameId });
    const c = seedPlaythrough(fx.ctx, { gameId });
    evento(a, 'started', '2026-01-10T18:00:00Z');
    evento(b, 'started', '2026-02-10T18:00:00Z');

    add({
      iterationId: c,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(eventosDe(a)[1].type, 'on_hold');
    assert.equal(eventosDe(b)[1].type, 'on_hold');
    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations.filter((it) => it.currentState === 'started').length, 1);
  });

  it('solo un started pausa: cualquier otro hito deja a los hermanos en paz', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');

    add({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(eventosDe(primero).length, 1);
  });

  it('un started en el mismo instante que el último evento del hermano sí lo pausa, y el juego se sigue leyendo Playing', () => {
    // Corte `<=`, y la pausa se crea ANTES que el evento nuevo: a igual
    // instante el evento nuevo es el más reciente por creación.
    const instante = '2026-05-05T12:00:00Z';
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', instante);

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date(instante),
      datePrecision: 'datetime',
    });

    const log = eventosDe(primero);
    assert.equal(log.length, 2);
    assert.equal(log[1].type, 'on_hold');

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations[0].currentState, 'on_hold');
    assert.equal(detalle.iterations[1].currentState, 'started');
    assert.equal(detalle.currentState, 'started');
  });
});

describe('addStateEvent — el hito terminal y la sesión que sigue viva', () => {
  it('terminar con el juego en marcha cierra la sesión en el instante del hito', () => {
    const { gameId, pt } = juegoConUno('Celeste');
    evento(pt, 'started', '2026-08-13T10:00:00Z');
    const sessionId = abierta(pt, '2026-08-13T10:00:00Z');

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:30:00Z'),
      datePrecision: 'datetime',
    });

    const fila = sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T12:30:00.000Z');
    assert.equal(fila.durationSec, 9000);

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.isLive, false);
    assert.equal(detalle.totalHours, 2.5);
  });

  it('un hito fechado ANTES del arranque de la sesión viva no la toca', () => {
    const { gameId, pt } = juegoConUno('Elden Ring');
    evento(pt, 'started', '2026-07-01T18:00:00Z');
    const sessionId = abierta(pt, '2026-08-13T10:00:00Z');

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-06T00:00:00Z'),
      datePrecision: 'day',
    });

    const viva = sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.currentState, 'completed');
    assert.equal(detalle.isLive, true);
  });

  it('marcar Beaten "hoy" con precisión de día cae a medianoche y por eso no cierra la sesión de esta tarde', () => {
    const { pt } = juegoConUno('Outer Wilds');
    const sessionId = abierta(pt, '2026-08-13T16:00:00Z');

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T00:00:00Z'),
      datePrecision: 'day',
    });

    const viva = sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
  });

  it('un hito exactamente en el arranque de la sesión sí la cierra, con duración cero', () => {
    const { pt } = juegoConUno('Katana Zero');
    const sessionId = abierta(pt, '2026-08-13T10:00:00Z');

    add({
      iterationId: pt,
      type: 'dropped',
      occurredAt: new Date('2026-08-13T10:00:00Z'),
      datePrecision: 'datetime',
    });

    const fila = sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T10:00:00.000Z');
    assert.equal(fila.durationSec, 0);
  });

  it('cierran la sesión los cuatro estados de closesOpenSession, y solo esos', () => {
    // 'plan_to_play' ya no es un tipo que se pueda escribir: tiene su propio
    // test en la parte del 2.0.
    const casos = [
      { type: 'completed', cierra: true },
      { type: 'dropped', cierra: true },
      { type: 'on_hold', cierra: true },
      { type: 'resting', cierra: true },
      { type: 'started', cierra: false },
    ] as const;

    for (const caso of casos) {
      const { pt } = juegoConUno('Stardew Valley');
      const sessionId = abierta(pt, '2026-08-13T10:00:00Z');

      add({
        iterationId: pt,
        type: caso.type,
        occurredAt: new Date('2026-08-13T11:00:00Z'),
        datePrecision: 'datetime',
      });

      const fila = sesion(sessionId);
      assert.equal(
        fila.endedAt !== null,
        caso.cierra,
        `${caso.type} ${caso.cierra ? 'debería' : 'no debería'} cerrar la sesión abierta`,
      );
      assert.equal(fila.durationSec, caso.cierra ? 3600 : null);
    }
  });

  it('una sesión ya cerrada no se recalcula ni se cuenta dos veces', () => {
    const { gameId, pt } = juegoConUno('Tunic');
    const sessionId = cerrada(pt, '2026-08-13T10:00:00Z', 2);

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T23:00:00Z'),
      datePrecision: 'datetime',
    });

    const fila = sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(fila.durationSec, 7200);
    assert.equal(derivedDetail(fx.ctx, gameId).totalHours, 2);
  });

  it('si el playthrough tenía DOS sesiones abiertas, el hito las cierra las dos', () => {
    const { gameId, pt } = juegoConUno('Chrono Trigger');
    const watcher = abierta(pt, '2026-08-13T10:00:00Z');
    const emulador = abierta(pt, '2026-08-13T11:00:00Z');

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    const primera = sesion(watcher);
    assert.equal(iso(primera.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(primera.durationSec, 7200);
    const segunda = sesion(emulador);
    assert.equal(iso(segunda.endedAt), '2026-08-13T12:00:00.000Z');
    // Cada una con SU duración: comparten el instante final, no el arranque.
    assert.equal(segunda.durationSec, 3600);

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.isLive, false);
    assert.equal(detalle.totalHours, 3);
  });

  it('con dos sesiones abiertas, la que empezó DESPUÉS del hito se queda viva y la otra no', () => {
    const { gameId, pt } = juegoConUno('Metroid Dread');
    const vieja = abierta(pt, '2026-08-13T10:00:00Z');
    const posterior = abierta(pt, '2026-08-13T14:00:00Z');

    add({
      iterationId: pt,
      type: 'dropped',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    const fila = sesion(vieja);
    assert.equal(iso(fila.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(fila.durationSec, 7200);

    const viva = sesion(posterior);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
    assert.equal(derivedDetail(fx.ctx, gameId).isLive, true);
  });

  it('al pausar al hermano también se le cierran sus DOS sesiones abiertas', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-08-13T09:00:00Z');
    const una = abierta(primero, '2026-08-13T09:30:00Z');
    const otra = abierta(primero, '2026-08-13T10:30:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(sesion(una).durationSec, 9000);
    assert.equal(sesion(otra).durationSec, 5400);
    assert.equal(derivedDetail(fx.ctx, gameId).isLive, false);
  });

  it('el hito solo cierra la sesión de SU playthrough, no la del hermano', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    const sessionId = abierta(primero, '2026-08-13T10:00:00Z');

    add({
      iterationId: segundo,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    const viva = sesion(sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.durationSec, null);
  });

  it('al pausar al hermano también se le cierra la sesión que tenía viva', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-08-13T09:00:00Z');
    const sessionId = abierta(primero, '2026-08-13T10:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations[0].currentState, 'on_hold');
    assert.equal(detalle.isLive, false);

    const fila = sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(fila.durationSec, 7200);
  });

  it('una pausa fechada ANTES del inicio de la sesión viva la deja abierta', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-08-10T09:00:00Z');
    const sessionId = abierta(primero, '2026-08-13T10:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T08:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(sesion(sessionId).endedAt, null);
    assert.equal(derivedDetail(fx.ctx, gameId).isLive, true);
  });
});

describe('addStateEvent — la fecha y su precisión', () => {
  it('la precisión llega al log tal cual, sin normalizar', () => {
    const { pt } = juegoConUno('Ico');
    for (const precision of ['year', 'month', 'day', 'datetime'] as const) {
      const creado = add({
        iterationId: pt,
        type: 'started',
        occurredAt: new Date('2019-06-01T00:00:00Z'),
        datePrecision: precision,
      });
      assert.equal(creado.datePrecision, precision);
    }
  });

  it('la pausa automática hereda el instante y la precisión del started que la provoca', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2023-04-01T00:00:00Z', 'year');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2024-01-01T00:00:00Z'),
      datePrecision: 'year',
    });

    const pausa = eventosDe(primero)[1];
    assert.equal(pausa.type, 'on_hold');
    assert.equal(pausa.datePrecision, 'year');
    assert.equal(iso(pausa.occurredAt), '2024-01-01T00:00:00.000Z');
  });

  it('sin occurredAt, el evento y la pausa del hermano caen en el MISMO instante: el del reloj', () => {
    // Con el reloj inyectado (`ctx.now()`) se puede afirmar además CUÁL es.
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2000-01-01T00:00:00Z');
    fx.wall.advance(1234);

    const creado = add({ iterationId: segundo, type: 'started', datePrecision: 'datetime' });

    const pausa = eventosDe(primero)[1];
    assert.equal(pausa.type, 'on_hold');
    assert.equal(pausa.occurredAt.getTime(), creado.occurredAt.getTime());
    assert.equal(creado.occurredAt.getTime(), T0 + 1234);
  });

  it('sin occurredAt, la sesión se cierra exactamente en el instante del evento', () => {
    const { pt } = juegoConUno('Dead Cells');
    const sessionId = abierta(pt, '2000-01-01T00:00:00Z');

    const creado = add({ iterationId: pt, type: 'dropped', datePrecision: 'datetime' });

    assert.equal(sesion(sessionId).endedAt?.getTime(), creado.occurredAt.getTime());
  });

  it('el instante se guarda al milisegundo aunque la duración se redondee al segundo', () => {
    const { pt } = juegoConUno('Vampire Survivors');
    const sessionId = abierta(pt, '2026-08-13T10:00:00.000Z');

    add({
      iterationId: pt,
      type: 'resting',
      occurredAt: new Date('2026-08-13T10:00:01.500Z'),
      datePrecision: 'datetime',
    });

    const fila = sesion(sessionId);
    assert.equal(iso(fila.endedAt), '2026-08-13T10:00:01.500Z');
    assert.equal(fila.durationSec, 2);
  });
});

describe('addStateEvent — el estado derivado que queda después', () => {
  it('la fecha de fin del playthrough es la del hito, no la de la sesión que cerró', () => {
    const { gameId, pt } = juegoConUno('Inside');
    evento(pt, 'started', '2026-08-13T10:00:00Z');
    abierta(pt, '2026-08-13T10:00:00Z');

    const creado = add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:30:00Z'),
      datePrecision: 'datetime',
      note: 'Final bueno',
    });

    assert.equal(creado.note, 'Final bueno');
    const iteracion = derivedDetail(fx.ctx, gameId).iterations[0];
    assert.equal(iso(iteracion.endedAt), '2026-08-13T12:30:00.000Z');
    assert.equal(iteracion.endEvent?.id, creado.id);
    assert.equal(iso(iteracion.startedAt), '2026-08-13T10:00:00.000Z');
  });

  it('retomar un playthrough pausado le quita la fecha de fin y devuelve la pausa al otro', () => {
    const { gameId, primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });
    add({
      iterationId: primero,
      type: 'started',
      occurredAt: new Date('2026-06-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations[0].currentState, 'started');
    assert.equal(detalle.iterations[0].endedAt, null);
    assert.equal(detalle.iterations[1].currentState, 'on_hold');
    assert.equal(iso(detalle.iterations[1].endedAt), '2026-06-01T20:00:00.000Z');
    assert.equal(detalle.iterations.filter((it) => it.currentState === 'started').length, 1);
    assert.equal(detalle.currentState, 'started');
  });
});

// ══ Propios del 2.0 ═════════════════════════════════════════════════════════

describe('addStateEvent [2.0] — tipos válidos', () => {
  it('plan_to_play ya no es un estado: invalid_value y no se escribe nada (ni la pausa)', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');
    const antes = count(fx.local, 'state_events');

    assert.throws(
      () =>
        addStateEvent(fx.ctx, {
          iterationId: segundo,
          type: 'plan_to_play' as AddStateEventInput<string>['type'],
          datePrecision: 'day',
        }),
      (error: unknown) => isStoreError(error, 'invalid_value'),
    );
    assert.equal(count(fx.local, 'state_events'), antes);
  });
});

describe("addStateEvent [2.0] — 'unknown': no consta cuándo pasó (R-07)", () => {
  it("se guarda 'unknown' tal cual y, sin occurredAt, la fecha es la del alta, no ahora", () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades', addedAt: day(-30) });
    const pt = seedPlaythrough(fx.ctx, { gameId });

    const creado = add({ iterationId: pt, type: 'completed', datePrecision: 'unknown' });

    assert.equal(creado.datePrecision, 'unknown');
    assert.equal(creado.occurredAt.getTime(), day(-30).getTime());
  });

  it('con promoción desde el Plan, la fecha desconocida es la de la promoción', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades', addedAt: day(-90), promotedAt: day(-2) });
    const pt = seedPlaythrough(fx.ctx, { gameId });

    const creado = add({ iterationId: pt, type: 'started', datePrecision: 'unknown' });

    assert.equal(creado.occurredAt.getTime(), day(-2).getTime());
  });

  it("con occurredAt explícito, 'unknown' no cambia la fecha indicada", () => {
    const { pt } = juegoConUno('Hades');
    const creado = add({
      iterationId: pt,
      type: 'started',
      occurredAt: at(5000),
      datePrecision: 'unknown',
    });
    assert.equal(creado.occurredAt.getTime(), T0 + 5000);
    assert.equal(creado.datePrecision, 'unknown');
  });
});

describe('addStateEvent [2.0] — solo se cierran las sesiones propias (R-10, R-12)', () => {
  it('la sesión abierta de otro PC se queda abierta; la propia se cierra con closedBy user', () => {
    const { gameId, pt } = juegoConUno('Celeste');
    const otro = asOtherDevice(fx.ctx);
    const ajena = otro.seedSession({
      playthroughId: pt,
      startedAt: new Date('2026-08-13T09:00:00Z'),
      endedAt: null,
    });
    const propia = abierta(pt, '2026-08-13T10:00:00Z');

    add({
      iterationId: pt,
      type: 'completed',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    const cerradaPropia = sesion(propia);
    assert.equal(iso(cerradaPropia.endedAt), '2026-08-13T12:00:00.000Z');
    assert.equal(cerradaPropia.closedBy, 'user');
    const abiertaAjena = sesion(ajena);
    assert.equal(abiertaAjena.endedAt, null);
    assert.equal(abiertaAjena.closedBy, null);
    // La ajena sigue "en vivo" hasta que su dueño la cierre (fase 4).
    assert.equal(derivedDetail(fx.ctx, gameId).isLive, true);
  });

  it('la pausa del hermano tampoco cierra la sesión de otro PC, y la propia con closedBy user', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-08-13T08:00:00Z');
    const otro = asOtherDevice(fx.ctx);
    const ajena = otro.seedSession({
      playthroughId: primero,
      startedAt: new Date('2026-08-13T09:00:00Z'),
      endedAt: null,
    });
    const propia = abierta(primero, '2026-08-13T10:00:00Z');

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-08-13T12:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(sesion(ajena).endedAt, null);
    assert.equal(sesion(propia).closedBy, 'user');
    assert.equal(eventosDe(primero)[1].type, 'on_hold');
  });
});

describe('addStateEvent [2.0] — dispositivo, filas vivas y errores', () => {
  it('el evento y la pausa automática llevan el deviceId de este PC', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');

    const creado = add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(eventosDe(segundo).find((e) => e.id === creado.id)?.deviceId, LOCAL);
    assert.equal(eventosDe(primero)[1].deviceId, LOCAL);
  });

  it('un hermano borrado no se pausa', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');
    fx.ctx.store.remove('playthroughs', primero);
    const antes = count(fx.local, 'state_events', `"playthroughId" = '${primero}'`);

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    assert.equal(count(fx.local, 'state_events', `"playthroughId" = '${primero}'`), antes);
  });

  it('un evento borrado del hermano no cuenta: su último estado real vuelve a ser started', () => {
    const { primero, segundo } = juegoConDosPlaythroughs();
    evento(primero, 'started', '2026-01-10T18:00:00Z');
    const pausa = evento(primero, 'on_hold', '2026-02-01T18:00:00Z');
    fx.ctx.store.remove('state_events', pausa);

    add({
      iterationId: segundo,
      type: 'started',
      occurredAt: new Date('2026-03-01T20:00:00Z'),
      datePrecision: 'datetime',
    });

    const log = eventosDe(primero);
    assert.deepEqual(
      log.map((e) => e.type),
      ['started', 'on_hold'],
    );
    assert.equal(iso(log[1].occurredAt), '2026-03-01T20:00:00.000Z');
  });

  it('playthrough inexistente → not_found; borrado → deleted; juego borrado (F-11) → deleted', () => {
    const { gameId, pt } = juegoConUno('Celeste');
    const borrado = seedPlaythrough(fx.ctx, { gameId });
    fx.ctx.store.remove('playthroughs', borrado);
    const antes = count(fx.local, 'state_events');

    const intento = (iterationId: string) => () =>
      addStateEvent(fx.ctx, { iterationId, type: 'started', datePrecision: 'day' });

    assert.throws(intento('0194c2f0-0000-7000-8000-000000000000'), (e: unknown) =>
      isStoreError(e, 'not_found'),
    );
    assert.throws(intento(borrado), (e: unknown) => isStoreError(e, 'deleted'));

    // Solo la lápida del juego, sin cascada: el playthrough sigue "vivo" en su
    // fila, pero la regla F-11 lo trata como borrado.
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.throws(intento(pt), (e: unknown) => isStoreError(e, 'deleted'));

    assert.equal(count(fx.local, 'state_events'), antes);
  });
});
