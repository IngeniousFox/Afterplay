import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { and, asc, eq } from 'drizzle-orm';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { stateEvents } from '../../../schema';
import { alive, isStoreError } from '../../../store';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedStateEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { deleteStateEvent, getAllStateEvents, updateStateEvent } from '../stateEvents';
import type { AddStateEventInputV2 } from '../types';
import { derivedDetail } from './detail';

// updateStateEvent, deleteStateEvent y getAllStateEvents sobre el esquema 2.0.
// Porta src/main/db/__tests__/stateEvents.test.ts: lo que se blinda es que lo
// que se ENSEÑA se recalcula solo al tocar el log (nada se ancla ni se
// cachea), así que cada corrección se comprueba con el estado derivado.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const UNKNOWN_ID = '0194c2f0-0000-7000-8000-000000000000';
const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

const juego = (title = 'Celeste'): { gameId: string; pt: string } => {
  const gameId = seedGame(fx.ctx, { title });
  return { gameId, pt: seedPlaythrough(fx.ctx, { gameId }) };
};

const evento = (
  playthroughId: string,
  type: AddStateEventInputV2['type'],
  occurredAt: string,
): string => seedStateEvent(fx.ctx, { playthroughId, type, occurredAt: new Date(occurredAt) });

const eventosDe = (playthroughId: string): { id: string; type: string }[] =>
  fx.ctx.db
    .select({ id: stateEvents.id, type: stateEvents.type })
    .from(stateEvents)
    .where(and(eq(stateEvents.playthroughId, playthroughId), alive(stateEvents)))
    .orderBy(asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all();

// ══ updateStateEvent (portados) ════════════════════════════════════════════

describe('updateStateEvent: corregir una fecha recalcula la ficha entera, sin tocarla a mano', () => {
  it('adelantar la fecha del completed mueve el fin del playthrough', () => {
    const { gameId, pt } = juego();
    evento(pt, 'started', '2026-01-01T00:00:00Z');
    const completedId = evento(pt, 'completed', '2026-02-01T00:00:00Z');

    assert.equal(
      iso(derivedDetail(fx.ctx, gameId).iterations[0].endedAt),
      '2026-02-01T00:00:00.000Z',
    );

    updateStateEvent(fx.ctx, completedId, { occurredAt: new Date('2026-05-15T00:00:00Z') });

    const after = derivedDetail(fx.ctx, gameId).iterations[0];
    assert.equal(iso(after.endedAt), '2026-05-15T00:00:00.000Z');
    assert.equal(after.endEvent?.id, completedId);
  });

  it('corregir el TIPO (Beaten -> Dropped) también se deriva, y el log sigue con una sola fila', () => {
    const { gameId, pt } = juego();
    evento(pt, 'started', '2026-01-01T00:00:00Z');
    const endId = evento(pt, 'completed', '2026-02-01T00:00:00Z');

    updateStateEvent(fx.ctx, endId, { type: 'dropped' });

    assert.equal(derivedDetail(fx.ctx, gameId).iterations[0].currentState, 'dropped');
    assert.deepEqual(
      eventosDe(pt).map((event) => event.type),
      ['started', 'dropped'],
    );
  });

  it('un patch vacío no toca la fila y la devuelve tal cual (F-33)', () => {
    const { pt } = juego();
    const eventId = evento(pt, 'started', '2026-01-01T00:00:00Z');
    markClean(fx.local, 'state_events');

    const result = updateStateEvent(fx.ctx, eventId, {});

    assert.equal(result?.id, eventId);
    assert.equal(result?.type, 'started');
    assert.equal(count(fx.local, 'state_events', 'syncDirty = 1'), 0);
  });

  it('un evento que no existe devuelve null en vez de reventar', () => {
    assert.equal(updateStateEvent(fx.ctx, UNKNOWN_ID, { occurredAt: new Date() }), null);
  });

  it('corregir un evento de una iteración no toca el estado derivado de otro juego', () => {
    const { pt } = juego('Se corrige');
    evento(pt, 'started', '2026-01-01T00:00:00Z');
    const completedId = evento(pt, 'completed', '2026-02-01T00:00:00Z');

    const vecino = juego('Vecino');
    evento(vecino.pt, 'started', '2026-01-01T00:00:00Z');
    evento(vecino.pt, 'completed', '2026-03-01T00:00:00Z');

    updateStateEvent(fx.ctx, completedId, { occurredAt: new Date('2026-06-01T00:00:00Z') });

    assert.equal(
      iso(derivedDetail(fx.ctx, vecino.gameId).iterations[0].endedAt),
      '2026-03-01T00:00:00.000Z',
    );
  });
});

describe('updateStateEvent [2.0]', () => {
  it('plan_to_play como tipo → invalid_value, sin escribir', () => {
    const { pt } = juego();
    const eventId = evento(pt, 'started', '2026-01-01T00:00:00Z');
    assert.throws(
      () =>
        updateStateEvent(fx.ctx, eventId, {
          type: 'plan_to_play' as AddStateEventInputV2['type'],
        }),
      (e: unknown) => isStoreError(e, 'invalid_value'),
    );
    assert.equal(rawRow(fx.local, 'state_events', eventId)?.type, 'started');
  });

  it("admite corregir la precisión a 'unknown' y la nota", () => {
    const { pt } = juego();
    const eventId = evento(pt, 'started', '2026-01-01T00:00:00Z');
    const row = updateStateEvent(fx.ctx, eventId, { datePrecision: 'unknown', note: 'no sé' });
    assert.equal(row?.datePrecision, 'unknown');
    assert.equal(row?.note, 'no sé');
  });

  it('null si el evento está borrado o su juego lo está (F-11)', () => {
    const { gameId, pt } = juego();
    const borrado = evento(pt, 'started', '2026-01-01T00:00:00Z');
    const huerfano = evento(pt, 'completed', '2026-02-01T00:00:00Z');
    deleteStateEvent(fx.ctx, borrado);
    assert.equal(updateStateEvent(fx.ctx, borrado, { note: 'x' }), null);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(updateStateEvent(fx.ctx, huerfano, { note: 'x' }), null);
    assert.equal(rawRow(fx.local, 'state_events', huerfano)?.note, null);
  });
});

// ══ deleteStateEvent (portados) ════════════════════════════════════════════

describe("deleteStateEvent: borrar el 'completed' reabre el playthrough, no lo deja huérfano", () => {
  it('borrar el completed vuelve al estado anterior del log, sin fecha de fin', () => {
    const { gameId, pt } = juego();
    evento(pt, 'started', '2026-01-01T00:00:00Z');
    const completedId = evento(pt, 'completed', '2026-02-01T00:00:00Z');
    assert.equal(derivedDetail(fx.ctx, gameId).iterations[0].currentState, 'completed');

    assert.equal(deleteStateEvent(fx.ctx, completedId), true);

    const after = derivedDetail(fx.ctx, gameId).iterations[0];
    assert.equal(after.currentState, 'started');
    assert.equal(after.endedAt, null);
    assert.equal(after.endEvent, null);
    // Es una lápida, no un DELETE: el sync tiene que enterarse del borrado.
    assert.notEqual(rawRow(fx.local, 'state_events', completedId)?.syncDeleted, null);
  });

  it('borrar un evento intermedio conserva el resto del historial intacto', () => {
    const { pt } = juego();
    const startedId = evento(pt, 'started', '2026-01-01T00:00:00Z');
    const onHoldId = evento(pt, 'on_hold', '2026-02-01T00:00:00Z');
    const resumedId = evento(pt, 'started', '2026-03-01T00:00:00Z');

    assert.equal(deleteStateEvent(fx.ctx, onHoldId), true);

    assert.deepEqual(
      eventosDe(pt).map((event) => event.id),
      [startedId, resumedId],
    );
  });

  it('un evento que no existe devuelve false, no revienta', () => {
    assert.equal(deleteStateEvent(fx.ctx, UNKNOWN_ID), false);
  });

  it('borrar el último evento de una iteración la deja Unplayed, no la borra a ella', () => {
    const { gameId, pt } = juego();
    const onlyEventId = evento(pt, 'started', '2026-01-01T00:00:00Z');

    assert.equal(deleteStateEvent(fx.ctx, onlyEventId), true);

    const iteration = derivedDetail(fx.ctx, gameId).iterations[0];
    assert.ok(iteration);
    assert.equal(iteration.currentState, null);
    assert.deepEqual(eventosDe(pt), []);
  });

  it('borrar un evento de un juego no toca el historial derivado de otro', () => {
    const { pt } = juego('Se corrige');
    evento(pt, 'started', '2026-01-01T00:00:00Z');
    const completedId = evento(pt, 'completed', '2026-02-01T00:00:00Z');

    const vecino = juego('Vecino');
    evento(vecino.pt, 'started', '2026-01-01T00:00:00Z');
    evento(vecino.pt, 'completed', '2026-03-01T00:00:00Z');

    deleteStateEvent(fx.ctx, completedId);

    const otro = derivedDetail(fx.ctx, vecino.gameId).iterations[0];
    assert.equal(otro.currentState, 'completed');
    assert.equal(iso(otro.endedAt), '2026-03-01T00:00:00.000Z');
  });
});

describe('deleteStateEvent [2.0]', () => {
  it('false si ya estaba borrado o su juego lo está (F-11), sin escribir', () => {
    const { gameId, pt } = juego();
    const eventId = evento(pt, 'started', '2026-01-01T00:00:00Z');
    const huerfano = evento(pt, 'completed', '2026-02-01T00:00:00Z');
    assert.equal(deleteStateEvent(fx.ctx, eventId), true);
    assert.equal(deleteStateEvent(fx.ctx, eventId), false);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(deleteStateEvent(fx.ctx, huerfano), false);
    assert.equal(rawRow(fx.local, 'state_events', huerfano)?.syncDeleted, null);
  });
});

// ══ getAllStateEvents ══════════════════════════════════════════════════════

describe('getAllStateEvents', () => {
  it('devuelve los eventos vivos con su juego y la etiqueta efectiva del playthrough', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const uno = seedPlaythrough(fx.ctx, { gameId });
    const dos = seedPlaythrough(fx.ctx, { gameId, customLabel: 'Cara B' });
    const tres = seedPlaythrough(fx.ctx, { gameId });
    const a = evento(uno, 'started', '2026-01-01T00:00:00Z');
    const b = evento(dos, 'completed', '2026-02-01T00:00:00Z');
    const c = evento(tres, 'dropped', '2026-03-01T00:00:00Z');

    const all = getAllStateEvents(fx.ctx);
    assert.deepEqual(
      all.map((e) => [e.id, e.gameId, e.iterationId, e.type, e.iterationLabel]),
      [
        [a, gameId, uno, 'started', 'Playthrough 1'],
        [b, gameId, dos, 'completed', 'Cara B'],
        [c, gameId, tres, 'dropped', 'Playthrough 3'],
      ],
    );
    assert.equal(iso(all[1].occurredAt), '2026-02-01T00:00:00.000Z');
    assert.equal(all[1].datePrecision, 'day');
  });

  it('borrar el 1 no renombra el 3 (R-03)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const uno = seedPlaythrough(fx.ctx, { gameId });
    seedPlaythrough(fx.ctx, { gameId });
    const tres = seedPlaythrough(fx.ctx, { gameId });
    evento(uno, 'started', '2026-01-01T00:00:00Z');
    evento(tres, 'started', '2026-03-01T00:00:00Z');
    fx.ctx.store.remove('playthroughs', uno);

    const all = getAllStateEvents(fx.ctx);
    assert.equal(all.length, 1);
    assert.equal(all[0].iterationLabel, 'Playthrough 3');
  });

  it('F-11: fuera los eventos borrados, los de un playthrough borrado y los de un juego borrado', () => {
    const vivo = juego('Vivo');
    const visible = evento(vivo.pt, 'started', '2026-01-01T00:00:00Z');
    const borrado = evento(vivo.pt, 'completed', '2026-02-01T00:00:00Z');
    deleteStateEvent(fx.ctx, borrado);

    const sinPt = juego('Sin playthrough');
    evento(sinPt.pt, 'started', '2026-01-01T00:00:00Z');
    tombstoneOnly(fx.ctx, 'playthroughs', sinPt.pt);

    const sinJuego = juego('Sin juego');
    evento(sinJuego.pt, 'started', '2026-01-01T00:00:00Z');
    tombstoneOnly(fx.ctx, 'games', sinJuego.gameId);

    assert.deepEqual(
      getAllStateEvents(fx.ctx).map((e) => e.id),
      [visible],
    );
  });

  it("'unknown' viaja tal cual en la precisión", () => {
    const { pt } = juego();
    seedStateEvent(fx.ctx, { playthroughId: pt, datePrecision: 'unknown' });
    assert.equal(getAllStateEvents(fx.ctx)[0].datePrecision, 'unknown');
  });

  it('sin eventos, lista vacía', () => {
    assert.deepEqual(getAllStateEvents(fx.ctx), []);
  });
});
