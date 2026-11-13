import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, rawRow } from '../../../__tests__/helpers';
import { openQueryDb, seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import { updateGame } from '../updateGame';

// games:update en 2.0. El patch del modal (`UpdateGamePatch`) lo prueba a
// fondo `common/__tests__/updateGame.test.ts`; aquí, lo que porta la
// referencia `ipc/__tests__/gamesUpdate.test.ts` a nivel de consulta (las
// claves fuera de la lista no llegan a la fila). El patch de partidas es de
// `saves/` (`updateSaveSettings`) y se prueba allí.

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
