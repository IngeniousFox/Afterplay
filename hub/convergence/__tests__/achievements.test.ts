import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { emulatorOrigin } from '../../../src/shared/sync/ids';
import { achievementUnlocks } from '../../../src/main/db/v2/schema';
import { getGameAchievements } from '../../../src/main/db/v2/queries/achievements/gameAchievements';
import { storeUnlocks } from '../../../src/main/db/v2/queries/achievements/storeUnlocks';
import { seedCatalog } from '../../../src/main/db/v2/queries/common/__tests__/fixtures';
import { addGame } from '../actions';
import { HOUR_MS, World, convergenceProblems, type Client } from '../harness';

// Escenario de aceptación de §17.3 de la fase 7 (logros de emulador, F-35):
// E-21. Hub real y clientes reales; lo que se comprueba sale de las consultas
// reales: `storeUnlocks` (la pasada local de emulador) y `getGameAchievements`
// (la lectura que pinta la ficha).

let world: World | null = null;

const start = (): World => {
  world = new World();
  return world;
};

afterEach(() => {
  world?.close();
  world = null;
});

async function settle(w: World): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w), []);
}

/** Las filas vivas de desbloqueo del juego, tal como las ve este PC. */
const rowsOf = (client: Client, gameId: string): { origin: string; unlockedAt: number }[] =>
  client.ctx.db
    .select()
    .from(achievementUnlocks)
    .where(and(eq(achievementUnlocks.gameId, gameId)))
    .all()
    .filter((row) => row.syncDeleted === null)
    .map((row) => ({ origin: row.origin, unlockedAt: row.unlockedAt.getTime() }))
    .sort((a, b) => (a.origin < b.origin ? -1 : 1));

/** Lo que enseña la ficha del único logro del juego. */
const shownBy = (
  client: Client,
  gameId: string,
): { unlockedAt: number | null; sources: string[] } => {
  const entry = getGameAchievements(client.ctx, gameId).entries[0];
  return { unlockedAt: entry?.unlockedAt?.getTime() ?? null, sources: entry?.sources ?? [] };
};

/** La pasada local de emulador de un PC (la que corre en cada arranque). */
const emulatorPass = (client: Client, gameId: string, unlockedAt: Date): void => {
  storeUnlocks(client.ctx, {
    gameId,
    feed: 'emu',
    unlocks: [{ apiName: 'ACH_1', unlockedAt }],
    fallbackDate: unlockedAt,
  });
};

describe('E-21: el mismo logro de emulador con fechas distintas en A y B', () => {
  it('dos filas; la ficha muestra la más temprana y no cambia entre arranques', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const game = addGame(a, 701, { title: 'Crack Quest' });
    seedCatalog(a.ctx, { gameId: game, items: [{ apiName: 'ACH_1' }] });
    await settle(w);

    // B lo consiguió antes que A, y cada uno lo apunta sin red.
    const early = new Date(Date.UTC(2026, 0, 10, 12, 0, 0));
    const late = new Date(Date.UTC(2026, 0, 20, 18, 30, 0));
    a.cut();
    b.cut();
    emulatorPass(a, game, late);
    emulatorPass(b, game, early);
    a.restore();
    b.restore();
    await settle(w);

    // Una fila por PC, con su propia fecha.
    const expectedRows = [
      { origin: emulatorOrigin(a.deviceId), unlockedAt: late.getTime() },
      { origin: emulatorOrigin(b.deviceId), unlockedAt: early.getTime() },
    ].sort((x, y) => (x.origin < y.origin ? -1 : 1));
    assert.deepEqual(rowsOf(a, game), expectedRows);
    assert.deepEqual(rowsOf(b, game), expectedRows);

    // La ficha enseña la más temprana en los dos, como UN solo 'emu'.
    for (const client of [a, b]) {
      assert.deepEqual(shownBy(client, game), { unlockedAt: early.getTime(), sources: ['emu'] });
    }

    // Reinicio de cada PC: la pasada de emulador vuelve a leer su fecha de
    // siempre. Ni cambia lo mostrado ni nacen filas nuevas.
    w.advance(HOUR_MS);
    emulatorPass(a, game, late);
    emulatorPass(b, game, early);
    await settle(w);
    for (const client of [a, b]) {
      assert.deepEqual(rowsOf(client, game), expectedRows);
      assert.deepEqual(shownBy(client, game), { unlockedAt: early.getTime(), sources: ['emu'] });
    }
  });
});
