import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { gamesTable } from '../schema';
import {
  ReadOnlyError,
  READ_ONLY_CODE,
  guardDb,
  isReadOnly,
  isReadOnlyError,
  onCutoverChange,
  resetReadOnlyForTests,
  setCutover,
  type CutoverInfo,
} from '../readOnly';
import { cleanupDbs, freshDb, makeGame, type TestDb } from './harness';

// El modo solo lectura del puente 1.8 (§19.3): con `cutover` presente, el
// guardia de getDb() rechaza toda escritura. Se prueba guardDb sobre una base
// de verdad (es lo mismo que getDb() devuelve en producción).

const cutover: CutoverInfo = {
  state: 'migrating',
  deviceId: 'pc-a',
  deviceName: 'PC A',
  appVersion: '2.0.0',
  at: 1,
};

let db: TestDb;

beforeEach(async () => {
  resetReadOnlyForTests();
  db = await freshDb();
});

after(() => {
  resetReadOnlyForTests();
  cleanupDbs();
});

describe('guardDb', () => {
  it('sin corte deja escribir y leer como siempre', async () => {
    const guarded = guardDb(db);
    const gameId = await makeGame(guarded, { title: 'Libre' });
    await guarded.update(gamesTable).set({ title: 'Cambiado' }).where(eq(gamesTable.id, gameId));
    const [row] = await guarded.select().from(gamesTable).where(eq(gamesTable.id, gameId));
    assert.equal(row.title, 'Cambiado');
  });

  for (const state of ['migrating', 'done'] as const) {
    it(`con cutover=${state} rechaza insert, update, delete y transaction pero deja leer`, async () => {
      const guarded = guardDb(db);
      const gameId = await makeGame(db, { title: 'Intacto' });
      setCutover({ ...cutover, state });

      await assert.rejects(
        async () => guarded.insert(gamesTable).values({ title: 'Nuevo', platform: 'PC' } as never),
        ReadOnlyError,
      );
      assert.throws(() => guarded.update(gamesTable).set({ title: 'X' }), ReadOnlyError);
      assert.throws(() => guarded.delete(gamesTable), ReadOnlyError);
      await assert.rejects(
        async () => guarded.transaction(async () => 1),
        (error: unknown) =>
          isReadOnlyError(error) && (error as ReadOnlyError).code === READ_ONLY_CODE,
      );

      const rows = await guarded.select().from(gamesTable);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, gameId);
      assert.equal(rows[0].title, 'Intacto');
    });
  }

  it('soltar el corte (la 2.0 abortó) levanta el modo', async () => {
    const guarded = guardDb(db);
    setCutover(cutover);
    assert.equal(isReadOnly(), true);
    setCutover(null);
    assert.equal(isReadOnly(), false);
    await makeGame(guarded, { title: 'Otra vez' });
  });

  it('el mensaje es el del banner', () => {
    assert.equal(new ReadOnlyError().message, 'This library has moved to Afterplay 2');
  });
});

describe('setCutover', () => {
  it('avisa solo cuando cambia el estado de solo lectura', () => {
    const calls: boolean[] = [];
    onCutoverChange((info) => calls.push(info !== null));
    setCutover(null);
    setCutover(cutover);
    setCutover({ ...cutover });
    setCutover({ ...cutover, state: 'done' });
    setCutover(null);
    assert.deepEqual(calls, [true, true, false]);
  });
});
