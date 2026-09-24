import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import {
  gamesTable,
  iterationsTable,
  saveBackupsTable,
  spendEventsTable,
  stateEventsTable,
} from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  makeIteration,
  makeSession,
  makeStateEvent,
  makeUnlock,
  type TestDb,
} from './harness';

let db: TestDb;
let moveToPlan: typeof import('../queries/games/moveToPlan').moveToPlan;
let getGameById: typeof import('../queries/games/getGameById').getGameById;
let getPlannedGames: typeof import('../queries/games/getPlannedGames').getPlannedGames;
let getGames: typeof import('../queries/games/getGames').getGames;

before(async () => {
  ({ moveToPlan } = await import('../queries/games/moveToPlan'));
  ({ getGameById } = await import('../queries/games/getGameById'));
  ({ getPlannedGames } = await import('../queries/games/getPlannedGames'));
  ({ getGames } = await import('../queries/games/getGames'));
});

beforeEach(async () => {
  db = await freshDb();
});

after(() => cleanupDbs());

describe('volver de Library a Plan to Play', () => {
  it('conserva la primera fecha del Plan, el juego, la nota y la compra', async () => {
    const addedAt = new Date('2025-03-05T08:00:00Z');
    const firstPlanAt = new Date('2025-03-05T08:00:01Z');
    const gameId = await makeGame(db, {
      title: 'Juego comprado sin jugar',
      addedAt,
      promotedAt: new Date('2026-02-01T10:00:00Z'),
      coverUrl: 'cover-del-plan',
      notes: 'Jugarlo en vacaciones',
    });
    const iterationId = await makeIteration(db, gameId);
    const planEventId = await makeStateEvent(
      db,
      iterationId,
      'plan_to_play',
      firstPlanAt.toISOString(),
      { note: 'Me lo recomendaron' },
    );
    await db.insert(spendEventsTable).values({
      gameId,
      type: 'purchase',
      amount: 19.99,
      occurredAt: new Date('2026-02-01T00:00:00Z'),
      datePrecision: 'day',
    });

    assert.equal((await getGameById(gameId))?.canMoveToPlan, true);
    const moved = await moveToPlan(gameId);
    assert.equal(moved.id, gameId);
    assert.equal(moved.planned, true);
    assert.deepEqual(moved.addedAt, addedAt);
    assert.equal(moved.promotedAt, null);
    assert.equal(moved.coverUrl, 'cover-del-plan');
    assert.equal(moved.notes, 'Jugarlo en vacaciones');
    assert.equal(
      (await getGames()).some((game) => game.id === gameId),
      false,
    );
    assert.deepEqual(
      (await getPlannedGames()).find((game) => game.id === gameId)?.addedAt,
      firstPlanAt,
    );

    const detail = await getGameById(gameId);
    assert.equal(detail?.canMoveToPlan, false);
    assert.deepEqual(
      detail?.stateHistory.map((event) => [event.id, event.note]),
      [[planEventId, 'Me lo recomendaron']],
    );
    assert.deepEqual(
      detail?.spendHistory.map((spend) => [spend.type, spend.amount]),
      [['purchase', 19.99]],
    );
    assert.deepEqual(
      detail?.iterations.map((iteration) => iteration.id),
      [iterationId],
    );
  });

  it('el primer paso al Plan desde Library empieza hoy y no cambia la fecha de alta', async () => {
    const originalAddedAt = new Date('2024-04-10T12:00:00Z');
    const gameId = await makeGame(db, { addedAt: originalAddedAt });
    const iterationId = await makeIteration(db, gameId);
    const before = Date.now();
    await moveToPlan(gameId);
    const after = Date.now();

    const [event] = await db
      .select({ occurredAt: stateEventsTable.occurredAt, type: stateEventsTable.type })
      .from(stateEventsTable)
      .where(eq(stateEventsTable.iterationId, iterationId));
    assert.equal(event.type, 'plan_to_play');
    assert.ok(event.occurredAt.getTime() >= before && event.occurredAt.getTime() <= after);
    assert.deepEqual((await getGameById(gameId))?.addedAt, originalAddedAt);
    assert.deepEqual((await getPlannedGames())[0].addedAt, event.occurredAt);

    // Volver a Library y luego al Plan no debe estrenar otra fecha de espera.
    await db.update(gamesTable).set({ planned: false }).where(eq(gamesTable.id, gameId));
    await moveToPlan(gameId);
    assert.deepEqual((await getPlannedGames())[0].addedAt, event.occurredAt);
    assert.equal(
      (
        await db
          .select({ id: stateEventsTable.id })
          .from(stateEventsTable)
          .where(eq(stateEventsTable.iterationId, iterationId))
      ).length,
      1,
    );
  });

  it('varias entradas conservan la fecha de la primera registrada aunque otra se feche hacia atrás', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const original = new Date('2025-05-01T09:00:00Z');
    await makeStateEvent(db, iterationId, 'plan_to_play', original.toISOString());
    await makeStateEvent(db, iterationId, 'plan_to_play', '2024-01-01T00:00:00Z');

    await moveToPlan(gameId);
    assert.deepEqual((await getPlannedGames())[0].addedAt, original);
  });

  it('rechaza un juego que ganó una sesión después de abrir la ficha', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    assert.equal((await getGameById(gameId))?.canMoveToPlan, true);
    await makeSession(db, iterationId, '2026-03-01T10:00:00Z', 0.5);
    await assert.rejects(moveToPlan(gameId));
    assert.equal((await getGameById(gameId))?.planned, false);
  });

  const blockers: [string, (gameId: number, iterationId: number) => Promise<void>][] = [
    [
      'un estado real',
      async (_gameId, iterationId) => {
        await makeStateEvent(db, iterationId, 'started', '2026-01-05T00:00:00Z');
      },
    ],
    [
      'horas manuales',
      async (_gameId, iterationId) => {
        await db
          .update(iterationsTable)
          .set({ manualTotalPlayed: 2 })
          .where(eq(iterationsTable.id, iterationId));
      },
    ],
    [
      'otro playthrough',
      async (gameId) => {
        await makeIteration(db, gameId, { label: 'Playthrough 2' });
      },
    ],
    [
      'gasto dentro del juego',
      async (gameId) => {
        await db.insert(spendEventsTable).values({
          gameId,
          type: 'ingame_spend',
          amount: 4.99,
          datePrecision: 'day',
        });
      },
    ],
    [
      'un logro desbloqueado',
      async (gameId) => {
        const achievementId = await makeAchievement(db, gameId, 'ACHIEVEMENT_TEST');
        await makeUnlock(db, achievementId, '2026-01-05T00:00:00Z');
      },
    ],
    [
      'una copia de partida',
      async (gameId) => {
        await db.insert(saveBackupsTable).values({
          gameId,
          backupName: 'backup.zip',
          r2Key: 'test/backup.zip',
          ludusaviName: 'Test game',
          machineId: 'test',
          machineName: 'Test',
          machineHome: 'C:/Test',
        });
      },
    ],
    [
      'una valoración del playthrough',
      async (_gameId, iterationId) => {
        await db
          .update(iterationsTable)
          .set({ rating: 4 })
          .where(eq(iterationsTable.id, iterationId));
      },
    ],
  ];

  for (const [label, addRecord] of blockers) {
    it(`no ofrece ni ejecuta el retorno si hay ${label}`, async () => {
      const gameId = await makeGame(db);
      const iterationId = await makeIteration(db, gameId);
      await addRecord(gameId, iterationId);
      assert.equal((await getGameById(gameId))?.canMoveToPlan, false);
      await assert.rejects(moveToPlan(gameId));
      assert.equal((await getGameById(gameId))?.planned, false);
    });
  }
});
