import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { clearCheck } from '../../common/checks';
import { deleteGame } from '../../games/deleteGame';
import { selectGamesToEnrich } from '../enrich';

// La detección de juegos "nunca preguntados" (§13.3): lo que crea el hub al
// añadir un juego desde el móvil (título e `igdbId`, sin `external_checks`).
// Todo con datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('selectGamesToEnrich', () => {
  it('un juego con igdbId y sin comprobaciones (alta del móvil) se completa', () => {
    const id = seedGame(fx.ctx, { title: 'Juego del movil', igdbId: 9001 });
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), [id]);
  });

  it('un juego ya preguntado no entra, salga bien, vacío o con fallo', () => {
    for (const status of ['ok', 'empty', 'error'] as const) {
      const id = seedGame(fx.ctx, { title: `Preguntado ${status}`, igdbId: 100 });
      seedCheck(fx.ctx, { gameId: id, source: 'igdb_ratings', status });
    }
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), []);
  });

  it('solo cuenta la comprobación de notas: otras fuentes no cubren al juego', () => {
    const id = seedGame(fx.ctx, { title: 'Solo appid', igdbId: 101 });
    seedCheck(fx.ctx, { gameId: id, source: 'steam_appid', status: 'ok' });
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), [id]);
  });

  it('un juego sin igdbId (alta manual o de Steam) no se completa por aquí', () => {
    seedGame(fx.ctx, { title: 'Sin igdb', igdbId: null });
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), []);
  });

  it('una comprobación con lápida cuenta como nunca preguntado', () => {
    const id = seedGame(fx.ctx, { title: 'Olvidado', igdbId: 102 });
    seedCheck(fx.ctx, { gameId: id, source: 'igdb_ratings', status: 'ok' });
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), []);
    clearCheck(fx.ctx, id, 'igdb_ratings');
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), [id]);
  });

  it('un juego borrado no entra', () => {
    const id = seedGame(fx.ctx, { title: 'Borrado', igdbId: 103 });
    assert.equal(deleteGame(fx.ctx, id), true);
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 10), []);
  });

  it('respeta el tope y va en orden de creación', () => {
    const ids = [201, 202, 203].map((igdbId) =>
      seedGame(fx.ctx, { title: `Juego ${igdbId}`, igdbId }),
    );
    assert.deepEqual(selectGamesToEnrich(fx.ctx, 2), ids.slice(0, 2));
  });

  it('es solo lectura: no escribe nada', () => {
    seedGame(fx.ctx, { title: 'Juego', igdbId: 300 });
    fx.local.db.$client.prepare('UPDATE "games" SET syncDirty = 0').run();
    selectGamesToEnrich(fx.ctx, 10);
    const dirty = fx.local.db.$client
      .prepare('SELECT count(*) AS n FROM "games" WHERE syncDirty = 1')
      .get();
    assert.equal(Number(dirty?.n), 0);
  });
});
