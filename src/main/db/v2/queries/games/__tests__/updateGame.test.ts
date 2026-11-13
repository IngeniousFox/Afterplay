import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { openQueryDb, seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import { updateGame, updateGameSaves } from '../updateGame';

// games:update en 2.0. El patch del modal (`UpdateGamePatch`) lo prueba a
// fondo `common/__tests__/updateGame.test.ts`; aquí, lo que porta la
// referencia `ipc/__tests__/gamesUpdate.test.ts` a nivel de consulta (las
// claves fuera de la lista no llegan a la fila) y el patch de partidas de P2.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('updateGame (reexportado de common)', () => {
  it('escribe las claves permitidas y descarta las demás: caché, Plan, fecha de alta, appid', () => {
    const id = seedGame(fx.ctx, {
      title: 'Antes',
      metadata: { summary: 'Sinopsis de IGDB', ratingCritics: 80 },
    });
    const addedAt = rawRow(fx.local, 'games', id)?.addedAt;
    const returned = updateGame(fx.ctx, id, {
      title: 'Después',
      notes: 'Mis notas',
      endless: true,
      summary: 'Pisada desde el renderer',
      ratingCritics: 1,
      planned: true,
      raGameId: 999,
      addedAt: new Date('2000-01-01T00:00:00Z'),
      steamAppId: 20,
    } as Parameters<typeof updateGame>[2]);
    assert.equal(returned?.title, 'Después');
    assert.equal(returned?.summary, 'Sinopsis de IGDB');
    assert.equal(returned?.ratingCritics, 80);
    assert.equal(returned?.planned, false);
    const row = rawRow(fx.local, 'games', id);
    assert.equal(row?.raGameId, null);
    assert.equal(row?.steamAppId, null);
    assert.equal(row?.addedAt, addedAt);
    assert.equal(count(fx.local, 'plan_entries'), 0);
  });
});

describe('updateGameSaves', () => {
  it('escribe las cuatro columnas de partidas y devuelve el juego releído', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    const row = updateGameSaves(fx.ctx, id, {
      saveBackupEnabled: true,
      saveDetectionSource: 'manual',
      saveLudusaviName: 'Celeste',
      saveCustomPaths: ['<home>/Saves/Celeste'],
    });
    assert.equal(row?.saveBackupEnabled, true);
    assert.equal(row?.saveDetectionSource, 'manual');
    assert.equal(row?.saveLudusaviName, 'Celeste');
    assert.deepEqual(row?.saveCustomPaths, ['<home>/Saves/Celeste']);

    const cleared = updateGameSaves(fx.ctx, id, {
      saveLudusaviName: null,
      saveDetectionSource: null,
    });
    assert.equal(cleared?.saveLudusaviName, null);
    assert.equal(cleared?.saveBackupEnabled, true);
  });

  it('ignora claves ajenas y no escribe si nada cambia (F-33)', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', saveBackupEnabled: true });
    markClean(fx.local, 'games');
    const row = updateGameSaves(fx.ctx, id, {
      saveBackupEnabled: true,
      title: 'Pisado',
    } as Parameters<typeof updateGameSaves>[2]);
    assert.equal(row?.title, 'Celeste');
    assert.equal(count(fx.local, 'games', 'syncDirty = 1'), 0);
  });

  it('null si el juego no existe o tiene lápida, sin escribir', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', id);
    markClean(fx.local, 'games');
    assert.equal(updateGameSaves(fx.ctx, id, { saveBackupEnabled: true }), null);
    assert.equal(updateGameSaves(fx.ctx, 'no-existe', { saveBackupEnabled: true }), null);
    assert.equal(count(fx.local, 'games', 'syncDirty = 1'), 0);
  });
});
