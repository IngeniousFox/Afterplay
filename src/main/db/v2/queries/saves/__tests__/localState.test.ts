import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { localSaveState } from '../../../schema';
import { seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import { getSaveRestoreTarget, getSaveRestoreTargets, setSaveRestoreTarget } from '../localState';
import { openSavesDb } from './fixture';

// Destino de restauración de este PC (local_save_state). Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

describe('destino de restauración', () => {
  it('se guarda por gameId de texto, con barras / y la hora del reloj', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(getSaveRestoreTarget(fx.ctx, id), null);
    setSaveRestoreTarget(fx.ctx, id, 'D:\\Juegos\\Celeste\\Saves\\');
    assert.deepEqual(getSaveRestoreTarget(fx.ctx, id), {
      target: 'D:/Juegos/Celeste/Saves',
      setAt: fx.ctx.now(),
    });

    fx.wall.advance(1_000);
    setSaveRestoreTarget(fx.ctx, id, 'E:/Saves');
    assert.deepEqual(getSaveRestoreTarget(fx.ctx, id), {
      target: 'E:/Saves',
      setAt: fx.ctx.now(),
    });
  });

  it('null o vacío lo borra (y la fila se va si no guarda huella)', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    setSaveRestoreTarget(fx.ctx, id, 'D:/x');
    setSaveRestoreTarget(fx.ctx, id, null);
    assert.equal(getSaveRestoreTarget(fx.ctx, id), null);
    assert.equal(fx.ctx.db.select().from(localSaveState).all().length, 0);
    setSaveRestoreTarget(fx.ctx, id, 'D:/x');
    setSaveRestoreTarget(fx.ctx, id, '');
    assert.equal(getSaveRestoreTarget(fx.ctx, id), null);
    setSaveRestoreTarget(fx.ctx, 'sin-fila', null); // no lanza
  });

  it('borrar el destino conserva la huella de la fase 6', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    setSaveRestoreTarget(fx.ctx, id, 'D:/x');
    fx.ctx.db.update(localSaveState).set({ lastSyncedHash: 'h1' }).run();
    setSaveRestoreTarget(fx.ctx, id, null);
    const rows = fx.ctx.db.select().from(localSaveState).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lastSyncedHash, 'h1');
    assert.equal(rows[0].restoreTarget, null);
    assert.equal(getSaveRestoreTarget(fx.ctx, id), null);
  });

  it('getSaveRestoreTargets: todos o los pedidos, en un mapa', () => {
    const a = seedGame(fx.ctx, { title: 'A' });
    const b = seedGame(fx.ctx, { title: 'B' });
    const c = seedGame(fx.ctx, { title: 'C' });
    setSaveRestoreTarget(fx.ctx, a, 'D:/a');
    setSaveRestoreTarget(fx.ctx, b, 'D:/b');
    assert.deepEqual([...getSaveRestoreTargets(fx.ctx).keys()].sort(), [a, b].sort());
    assert.deepEqual([...getSaveRestoreTargets(fx.ctx, [b, c]).keys()], [b]);
    assert.equal(getSaveRestoreTargets(fx.ctx, []).size, 0);
  });
});
