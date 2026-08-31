import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import {
  achievementsTable,
  achievementUnlocksTable,
  iterationsTable,
  sessionsTable,
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

// deleteGame.ts es un DELETE de una fila y nada más — todo lo demás lo hace
// SQLite solo, vía los ON DELETE CASCADE del schema (iterations -> gameId,
// state_events -> iterationId, sessions -> iterationId, spend_events ->
// gameId, achievements -> gameId, achievement_unlocks -> achievementId).
//
// Lo que se blinda aquí NO es la función (una línea), es que la cadena de
// CASCADE está de verdad conectada de punta a punta en las migraciones
// reales: si algún día una migración reconstruye una tabla (ver la cabecera
// de schema.ts sobre las reconstrucciones de Turso) y se olvida la cláusula
// ON DELETE en una FK, este test es el que lo nota — un mock de drizzle
// nunca lo haría, porque el CASCADE no vive en el código, vive en el DDL.
//
// Y el borde simétrico: un juego VECINO con su propio historial no puede
// perder ni una fila porque el filtro de las FK sea por columna y no por
// valor (un `iterationId` compartido por error, un WHERE que se pierde).

let db: TestDb;
let deleteGame: typeof import('../queries/games/deleteGame').deleteGame;

before(async () => {
  ({ deleteGame } = await import('../queries/games/deleteGame'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// Gasto sin fábrica en el andamio: mínimo necesario para escribir la fila.
const makeSpend = async (database: TestDb, gameId: number, amount: number): Promise<number> => {
  const [row] = await database
    .insert(spendEventsTable)
    .values({
      gameId,
      type: 'purchase',
      amount,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      datePrecision: 'day',
    })
    .returning({ id: spendEventsTable.id });
  return row.id;
};

// Un juego con TODO su historial poblado: una iteración, una sesión medida,
// un evento de estado, un gasto y un logro con un desbloqueo. Devuelve los
// ids que hacen falta para comprobar después que cada tabla se vació.
const gameWithFullHistory = async (
  database: TestDb,
  title: string,
): Promise<{
  gameId: number;
  iterationId: number;
  sessionId: number;
  stateEventId: number;
  spendId: number;
  achievementId: number;
  unlockId: number;
}> => {
  const gameId = await makeGame(database, { title });
  const iterationId = await makeIteration(database, gameId);
  const sessionId = await makeSession(database, iterationId, '2026-01-10T18:00:00Z', 2);
  const stateEventId = await makeStateEvent(
    database,
    iterationId,
    'started',
    '2026-01-10T18:00:00Z',
  );
  const spendId = await makeSpend(database, gameId, 39.99);
  const achievementId = await makeAchievement(database, gameId, 'SUMMIT');
  const unlockId = await makeUnlock(database, achievementId, '2026-01-11T10:00:00Z');
  return { gameId, iterationId, sessionId, stateEventId, spendId, achievementId, unlockId };
};

describe('deleteGame: borrar un juego con historial se lleva TODO lo suyo, y solo lo suyo', () => {
  it('arrastra iterations, sessions, state_events, spend y achievements/unlocks por ON DELETE CASCADE', async () => {
    const borrado = await gameWithFullHistory(db, 'Se borra');

    const ok = await deleteGame(borrado.gameId);

    assert.equal(ok, true);
    assert.equal((await db.select().from(iterationsTable)).length, 0);
    assert.equal((await db.select().from(sessionsTable)).length, 0);
    assert.equal((await db.select().from(stateEventsTable)).length, 0);
    assert.equal((await db.select().from(spendEventsTable)).length, 0);
    assert.equal((await db.select().from(achievementsTable)).length, 0);
    // El desbloqueo cuelga de achievements, no de games: si el CASCADE se
    // frenara en el catálogo (una FK sin ON DELETE en achievement_unlocks),
    // esta fila se quedaría huérfana señalando a un achievementId que ya no
    // existe, y es justo el tipo de fuga que un mock no vería nunca.
    assert.equal((await db.select().from(achievementUnlocksTable)).length, 0);
  });

  it('un juego vecino con su propio historial no pierde ni una fila', async () => {
    const borrado = await gameWithFullHistory(db, 'Se borra');
    const vecino = await gameWithFullHistory(db, 'Se queda');

    await deleteGame(borrado.gameId);

    // Comprobado por FILA, no por conteo global: un conteo de "queda 1"
    // pasaría igual si el CASCADE hubiera borrado la fila del vecino y algo
    // hubiera vuelto a crear otra por casualidad. Aquí hace falta que sea
    // EXACTAMENTE la misma fila que se sembró.
    const [iteration] = await db
      .select()
      .from(iterationsTable)
      .where(eq(iterationsTable.id, vecino.iterationId));
    assert.ok(iteration);
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, vecino.sessionId));
    assert.ok(session);
    const [stateEvent] = await db
      .select()
      .from(stateEventsTable)
      .where(eq(stateEventsTable.id, vecino.stateEventId));
    assert.ok(stateEvent);
    const [spend] = await db
      .select()
      .from(spendEventsTable)
      .where(eq(spendEventsTable.id, vecino.spendId));
    assert.ok(spend);
    const [achievement] = await db
      .select()
      .from(achievementsTable)
      .where(eq(achievementsTable.id, vecino.achievementId));
    assert.ok(achievement);
    const [unlock] = await db
      .select()
      .from(achievementUnlocksTable)
      .where(eq(achievementUnlocksTable.id, vecino.unlockId));
    assert.ok(unlock);
  });

  it('un juego sin historial se borra igual: false CASCADE no significa nada que arrastrar', async () => {
    const gameId = await makeGame(db, { title: 'Recién añadido' });

    assert.equal(await deleteGame(gameId), true);
  });

  it('borrar un id que no existe devuelve false, no revienta', async () => {
    // El contrato con el IPC: dos ventanas, dos clics de borrar sobre el
    // mismo juego, y el segundo tiene que poder contestar "ya no está" en
    // vez de tirar una excepción sin capturar hacia el renderer.
    assert.equal(await deleteGame(9999), false);
  });
});
