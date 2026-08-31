import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import type { GameDetail } from '../../../shared/types';
import { stateEventsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeStateEvent,
  type TestDb,
} from './harness';

// updateStateEvent y deleteStateEvent son las dos correcciones de erratas del
// log (ver sus propias cabeceras): "me equivoqué de fecha", "este desenlace
// nunca pasó", "apunté un estado que no fue". El log en sí es append-only —
// lo que se blinda AQUÍ no son las dos funciones sueltas (un UPDATE y un
// DELETE de una fila), es que lo que se ENSEÑA se recalcula solo al tocar el
// log: en el modelo v2 nada se ancla ni se cachea, así que la ficha
// (getGameById) tiene que leer distinto en cuanto cambia una fila de
// state_events, sin que nadie llame a un "recompute" aparte. Por eso cada
// test que corrige o borra un evento comprueba el resultado a través de
// getGameById, no del valor de retorno de la propia función.

let db: TestDb;
let getGameById: typeof import('../queries/games/getGameById').getGameById;
let updateStateEvent: typeof import('../queries/stateEvents/updateStateEvent').updateStateEvent;
let deleteStateEvent: typeof import('../queries/stateEvents/deleteStateEvent').deleteStateEvent;

before(async () => {
  ({ getGameById } = await import('../queries/games/getGameById'));
  ({ updateStateEvent } = await import('../queries/stateEvents/updateStateEvent'));
  ({ deleteStateEvent } = await import('../queries/stateEvents/deleteStateEvent'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

const detail = async (gameId: number): Promise<GameDetail> => {
  const game = await getGameById(gameId);
  if (!game) throw new Error(`getGameById(${gameId}) devolvió null y el test esperaba la ficha`);
  return game;
};

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

const eventsOf = async (iterationId: number): Promise<{ id: number; type: string }[]> =>
  db
    .select({ id: stateEventsTable.id, type: stateEventsTable.type })
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iterationId))
    .orderBy(asc(stateEventsTable.id));

// ══ updateStateEvent ═══════════════════════════════════════════════════════

describe('updateStateEvent: corregir una fecha recalcula la ficha entera, sin tocarla a mano', () => {
  it('adelantar la fecha del completed mueve el fin del playthrough que enseña getGameById', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const completedId = await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    const before = (await detail(gameId)).iterations[0];
    assert.equal(iso(before.endedAt), '2026-02-01T00:00:00.000Z');

    await updateStateEvent(completedId, { occurredAt: new Date('2026-05-15T00:00:00Z') });

    const after = (await detail(gameId)).iterations[0];
    assert.equal(iso(after.endedAt), '2026-05-15T00:00:00.000Z');
    // Nadie escribió un endedAt en ningún sitio: es la MISMA lectura
    // derivando distinto porque la fila de abajo cambió.
    assert.equal(after.endEvent?.id, completedId);
  });

  it('corregir el TIPO (Beaten -> Dropped) es la corrección de playthrough del Edit modal, y también se deriva', async () => {
    // El caso real citado en la cabecera de updateStateEvent.ts: te apuntaste
    // "me lo pasé" y en realidad lo dejaste a medias. El evento no se borra ni
    // se añade uno nuevo — se corrige la fila, porque el desenlace apuntado
    // fue una ERRATA, no un cambio de opinión (eso sí se apila desde Status).
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const endId = await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    await updateStateEvent(endId, { type: 'dropped' });

    const iteration = (await detail(gameId)).iterations[0];
    assert.equal(iteration.currentState, 'dropped');
    // Y el log sigue teniendo UNA sola fila para ese desenlace, no dos.
    assert.deepEqual(
      (await eventsOf(iterationId)).map((event) => event.type),
      ['started', 'dropped'],
    );
  });

  it('un patch vacío no toca la fila: guardar el formulario sin cambiar nada no revienta el UPDATE', async () => {
    // Drizzle peta con un .set() vacío (ver la cabecera de updateOrFetch.ts).
    // Sin la guarda, cerrar el modal de corrección de fecha sin tocar el
    // datepicker lanzaría en vez de devolver la fila tal cual.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const eventId = await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');

    const result = await updateStateEvent(eventId, {});

    assert.equal(result?.id, eventId);
    assert.equal(result?.type, 'started');
  });

  it('un evento que no existe devuelve null en vez de reventar', async () => {
    // Carrera con otra ventana borrando el mismo evento desde el History justo
    // antes de que este PC mande su corrección de fecha por sync.
    assert.equal(await updateStateEvent(9999, { occurredAt: new Date() }), null);
  });

  it('corregir un evento de una iteración no toca el estado derivado de otro juego', async () => {
    const gameId = await makeGame(db, { title: 'Se corrige' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const completedId = await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    const vecinoId = await makeGame(db, { title: 'Vecino' });
    const vecinoIterationId = await makeIteration(db, vecinoId);
    await makeStateEvent(db, vecinoIterationId, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, vecinoIterationId, 'completed', '2026-03-01T00:00:00Z');

    await updateStateEvent(completedId, { occurredAt: new Date('2026-06-01T00:00:00Z') });

    const vecino = (await detail(vecinoId)).iterations[0];
    assert.equal(iso(vecino.endedAt), '2026-03-01T00:00:00.000Z');
  });
});

// ══ deleteStateEvent ═══════════════════════════════════════════════════════

describe("deleteStateEvent: borrar el 'completed' reabre el playthrough, no lo deja huérfano", () => {
  it('borrar el completed hace que la ficha vuelva a enseñar el estado anterior del log, sin fecha de fin', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const completedId = await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    const before = (await detail(gameId)).iterations[0];
    assert.equal(before.currentState, 'completed');

    assert.equal(await deleteStateEvent(completedId), true);

    const after = (await detail(gameId)).iterations[0];
    assert.equal(after.currentState, 'started');
    assert.equal(after.endedAt, null);
    assert.equal(after.endEvent, null);
  });

  it('borrar un evento intermedio conserva el resto del historial intacto', async () => {
    // "Apunté un on_hold que no fue" (un despiste, ver cabecera de
    // deleteStateEvent.ts): se quita esa fila y las demás siguen ahí, con sus
    // ids de siempre — no se reescribe ni se reordena nada.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const startedId = await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const onHoldId = await makeStateEvent(db, iterationId, 'on_hold', '2026-02-01T00:00:00Z');
    const resumedId = await makeStateEvent(db, iterationId, 'started', '2026-03-01T00:00:00Z');

    assert.equal(await deleteStateEvent(onHoldId), true);

    assert.deepEqual(
      (await eventsOf(iterationId)).map((event) => event.id),
      [startedId, resumedId],
    );
  });

  it('un evento que no existe devuelve false, no revienta', async () => {
    assert.equal(await deleteStateEvent(9999), false);
  });

  it('borrar el último evento de una iteración la deja Unplayed, no la borra a ella', async () => {
    // La cabecera de deleteStateEvent.ts lo dice explícito: la iteración
    // dueña se queda aunque se vacíe — es el estado legítimo de "recién
    // creada sin tocar", el mismo que resolveIterationForPlay sabe reanudar.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const onlyEventId = await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');

    assert.equal(await deleteStateEvent(onlyEventId), true);

    const iteration = (await detail(gameId)).iterations[0];
    assert.ok(iteration);
    assert.equal(iteration.currentState, null);
    assert.deepEqual(await eventsOf(iterationId), []);
  });

  it('borrar un evento de un juego no toca el historial derivado de otro', async () => {
    const gameId = await makeGame(db, { title: 'Se corrige' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    const completedId = await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    const vecinoId = await makeGame(db, { title: 'Vecino' });
    const vecinoIterationId = await makeIteration(db, vecinoId);
    await makeStateEvent(db, vecinoIterationId, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, vecinoIterationId, 'completed', '2026-03-01T00:00:00Z');

    await deleteStateEvent(completedId);

    const vecino = (await detail(vecinoId)).iterations[0];
    assert.equal(vecino.currentState, 'completed');
    assert.equal(iso(vecino.endedAt), '2026-03-01T00:00:00.000Z');
  });
});
