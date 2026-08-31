import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { iterationsTable, sessionsTable, stateEventsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// resetEndlessState convierte un juego normal a endless. Lo que blinda este
// fichero es la frase de su propia cabecera: se borran TODOS los stateEvents
// salvo 'plan_to_play' (que es historial de INTENCIÓN, no de partida), EN
// TODAS las iteraciones del juego, y las sesiones y las horas manuales se
// CONSERVAN — un endless no pierde ni un minuto medido, solo la noción de
// "partida discreta con desenlace" que sus eventos describían.

let db: TestDb;
let resetEndlessState: typeof import('../queries/games/resetEndlessState').resetEndlessState;

before(async () => {
  ({ resetEndlessState } = await import('../queries/games/resetEndlessState'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

const eventTypesOf = async (iterationId: number): Promise<string[]> =>
  (
    await db
      .select({ type: stateEventsTable.type })
      .from(stateEventsTable)
      .where(eq(stateEventsTable.iterationId, iterationId))
      .orderBy(asc(stateEventsTable.id))
  ).map((row) => row.type);

const sessionCountOf = async (iterationId: number): Promise<number> =>
  (await db.select().from(sessionsTable).where(eq(sessionsTable.iterationId, iterationId))).length;

describe('resetEndlessState: se borra el desenlace, no la partida', () => {
  it('borra todo el log salvo plan_to_play, en TODAS las iteraciones, y conserva sesiones y horas manuales', async () => {
    const gameId = await makeGame(db, { title: 'Se hace endless' });

    const first = await makeIteration(db, gameId, {
      label: 'Playthrough 1',
      manualTotalPlayed: 10,
    });
    await makeStateEvent(db, first, 'plan_to_play', '2025-12-01T00:00:00Z');
    await makeStateEvent(db, first, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-02-01T00:00:00Z');
    await makeSession(db, first, '2026-01-10T18:00:00Z', 3);

    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-03-01T00:00:00Z');
    await makeStateEvent(db, second, 'on_hold', '2026-04-01T00:00:00Z');
    await makeSession(db, second, '2026-03-10T18:00:00Z', 5);

    const ok = await resetEndlessState(gameId);

    assert.equal(ok, true);
    // El plan sobrevive, el resto del desenlace no.
    assert.deepEqual(await eventTypesOf(first), ['plan_to_play']);
    // La segunda iteración no tenía plan_to_play: se queda sin ningún evento,
    // no con uno inventado.
    assert.deepEqual(await eventTypesOf(second), []);
    // Lo medido y lo manual, intactos.
    assert.equal(await sessionCountOf(first), 1);
    assert.equal(await sessionCountOf(second), 1);
    const [row] = await db
      .select({ manualTotalPlayed: iterationsTable.manualTotalPlayed })
      .from(iterationsTable)
      .where(eq(iterationsTable.id, first));
    assert.equal(row.manualTotalPlayed, 10);
  });

  it('un juego sin iteraciones no revienta: no hay nada que limpiar', async () => {
    const gameId = await makeGame(db, { title: 'Recién añadido' });

    assert.equal(await resetEndlessState(gameId), true);
  });

  it('no toca el log de OTRO juego, endless o no', async () => {
    const gameId = await makeGame(db, { title: 'Se hace endless' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z');

    const vecinoId = await makeGame(db, { title: 'Vecino' });
    const vecinoIterationId = await makeIteration(db, vecinoId);
    await makeStateEvent(db, vecinoIterationId, 'started', '2026-01-05T00:00:00Z');
    await makeStateEvent(db, vecinoIterationId, 'completed', '2026-02-05T00:00:00Z');

    await resetEndlessState(gameId);

    assert.deepEqual(await eventTypesOf(vecinoIterationId), ['started', 'completed']);
  });

  it('un plan_to_play repetido en varias iteraciones sobrevive en cada una', async () => {
    // Caso de un juego con más de un playthrough que además fue planeado más
    // de una vez (raro, pero el filtro es por TIPO de evento, no por "el
    // primero que se encuentre") — cada plan_to_play es historial propio de
    // su iteración y ninguno se pisa entre sí.
    const gameId = await makeGame(db, { title: 'Replanificado' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const planFirst = await makeStateEvent(db, first, 'plan_to_play', '2025-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2025-06-01T00:00:00Z');
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    const planSecond = await makeStateEvent(db, second, 'plan_to_play', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, second, 'started', '2026-02-01T00:00:00Z');

    await resetEndlessState(gameId);

    const remainingFirst = await db
      .select({ id: stateEventsTable.id })
      .from(stateEventsTable)
      .where(eq(stateEventsTable.iterationId, first));
    const remainingSecond = await db
      .select({ id: stateEventsTable.id })
      .from(stateEventsTable)
      .where(eq(stateEventsTable.iterationId, second));
    assert.deepEqual(
      remainingFirst.map((row) => row.id),
      [planFirst],
    );
    assert.deepEqual(
      remainingSecond.map((row) => row.id),
      [planSecond],
    );
  });
});
