import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { gameCuriosities, type GameCuriositiesRow } from '../../../schema';
import { readCheck } from '../../common';
import {
  day,
  openQueryDb,
  seedCuriosities,
  seedGame,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  getAllCuriosities,
  getCuriositiesCounts,
  getGameCuriosities,
  getPendingCuriositiesGames,
  storeCuriosities,
} from '../curiosities';

// Curiosidades sobre `game_curiosities` (una fila por juego con la lista en
// JSON). Los dos primeros casos son los de
// `src/main/db/__tests__/curiositiesCounts.test.ts`; "generado" pasa de
// `games.curiositiesGeneratedAt` a tener fila viva.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const rawRow = (gameId: string): GameCuriositiesRow | undefined =>
  fx.ctx.db.select().from(gameCuriosities).where(eq(gameCuriosities.gameId, gameId)).get();

describe('contadores y pendientes (1.x)', () => {
  it('cuenta las dos cifras sin los planeados, y lista solo los pendientes', () => {
    const hecho = seedGame(fx.ctx, { title: 'Hecho' });
    seedCuriosities(fx.ctx, { gameId: hecho, generatedAt: new Date(0) });
    const pendiente = seedGame(fx.ctx, { title: 'Pendiente' });
    const planeadoHecho = seedGame(fx.ctx, { title: 'Planeado hecho', planned: true });
    seedCuriosities(fx.ctx, { gameId: planeadoHecho });
    seedGame(fx.ctx, { title: 'Planeado', planned: true });

    assert.deepEqual(getCuriositiesCounts(fx.ctx), { totalGames: 2, generatedGames: 1 });
    assert.deepEqual(
      getPendingCuriositiesGames(fx.ctx).map((game) => game.id),
      [pendiente],
    );
  });

  it('una biblioteca vacía da ceros aunque haya planeados con curiosidades', () => {
    assert.deepEqual(getCuriositiesCounts(fx.ctx), { totalGames: 0, generatedGames: 0 });
    const planeado = seedGame(fx.ctx, { title: 'Planeado', planned: true });
    seedCuriosities(fx.ctx, { gameId: planeado });
    assert.deepEqual(getCuriositiesCounts(fx.ctx), { totalGames: 0, generatedGames: 0 });
  });
});

describe('getPendingCuriositiesGames', () => {
  it('trae lo que necesita el prompt, con el desarrollador efectivo', () => {
    const id = seedGame(fx.ctx, {
      title: 'Prey',
      igdbId: 11,
      developerOverride: 'Arkane Austin',
      metadata: { developer: 'Arkane', releaseYear: 2017 },
    });
    assert.deepEqual(getPendingCuriositiesGames(fx.ctx), [
      { id, igdbId: 11, title: 'Prey', releaseYear: 2017, developer: 'Arkane Austin' },
    ]);
  });

  it('ni juegos borrados ni juegos con una lista vacía (también es una respuesta)', () => {
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', borrado);
    const vacio = seedGame(fx.ctx, { title: 'Sin nada que contar' });
    storeCuriosities(fx.ctx, vacio, [], 'modelo');
    assert.deepEqual(getPendingCuriositiesGames(fx.ctx), []);
    assert.deepEqual(getCuriositiesCounts(fx.ctx), { totalGames: 1, generatedGames: 1 });
  });

  it('una fila de curiosidades con lápida cuenta como no generada', () => {
    const id = seedGame(fx.ctx, { title: 'Regenerable' });
    seedCuriosities(fx.ctx, { gameId: id });
    fx.ctx.store.remove('game_curiosities', id);
    assert.deepEqual(
      getPendingCuriositiesGames(fx.ctx).map((g) => g.id),
      [id],
    );
    assert.deepEqual(getCuriositiesCounts(fx.ctx), { totalGames: 1, generatedGames: 0 });
  });
});

describe('storeCuriosities', () => {
  it('guarda la lista con fecha y modelo, y apunta la comprobación', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(storeCuriosities(fx.ctx, id, ['Uno.', 'Dos.'], 'modelo-x'), true);
    const row = rawRow(id);
    assert.deepEqual(
      { items: row?.items, generatedAt: row?.generatedAt, model: row?.model },
      { items: ['Uno.', 'Dos.'], generatedAt: fx.ctx.now(), model: 'modelo-x' },
    );
    assert.equal(readCheck(fx.ctx, id, 'curiosities')?.status, 'ok');
  });

  it('regenerar escribe encima: la lista nueva sustituye a la anterior', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    storeCuriosities(fx.ctx, id, ['Uno.', 'Dos.', 'Tres.'], 'modelo-x');
    fx.wall.advance(1000);
    storeCuriosities(fx.ctx, id, ['Otra.'], 'modelo-y');
    assert.deepEqual(getAllCuriosities(fx.ctx), [{ gameId: id, text: 'Otra.' }]);
    assert.equal(rawRow(id)?.model, 'modelo-y');
    assert.equal(rawRow(id)?.generatedAt.getTime(), fx.ctx.now().getTime());
  });

  it('una lista vacía queda registrada (no se vuelve a pagar) con la comprobación `empty`', () => {
    const id = seedGame(fx.ctx, { title: 'Oscuro' });
    assert.equal(storeCuriosities(fx.ctx, id, [], 'modelo-x'), true);
    assert.deepEqual(rawRow(id)?.items, []);
    assert.equal(readCheck(fx.ctx, id, 'curiosities')?.status, 'empty');
    assert.deepEqual(getAllCuriosities(fx.ctx), []);
  });

  it('juego borrado o inexistente: no escribe nada ni resucita su fila (R-15)', () => {
    const id = seedGame(fx.ctx, { title: 'Borrado' });
    seedCuriosities(fx.ctx, { gameId: id, items: ['Vieja.'] });
    fx.ctx.store.remove('game_curiosities', id);
    fx.ctx.store.remove('games', id);
    assert.equal(storeCuriosities(fx.ctx, id, ['Nueva.'], 'modelo-x'), false);
    const row = rawRow(id);
    assert.notEqual(row?.syncDeleted, null);
    assert.deepEqual(row?.items, ['Vieja.']);
    assert.equal(readCheck(fx.ctx, id, 'curiosities'), undefined);

    assert.equal(storeCuriosities(fx.ctx, 'no-existe', ['X.'], 'modelo-x'), false);
  });
});

describe('getAllCuriosities', () => {
  it('una entrada por frase, en el orden de cada lista, solo de juegos vivos', () => {
    const a = seedGame(fx.ctx, { title: 'A' });
    const b = seedGame(fx.ctx, { title: 'B' });
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    seedCuriosities(fx.ctx, { gameId: a, items: ['A1', 'A2'], generatedAt: day(1) });
    seedCuriosities(fx.ctx, { gameId: b, items: ['B1'] });
    seedCuriosities(fx.ctx, { gameId: borrado, items: ['X'] });
    // Borrar el juego deja la caché (keep), pero no se enseña.
    tombstoneOnly(fx.ctx, 'games', borrado);

    assert.deepEqual(getAllCuriosities(fx.ctx), [
      { gameId: a, text: 'A1' },
      { gameId: a, text: 'A2' },
      { gameId: b, text: 'B1' },
    ]);
  });
});

describe('getGameCuriosities', () => {
  it('devuelve las de un juego vivo en su orden, y nada de uno borrado o sin ellas', () => {
    const a = seedGame(fx.ctx, { title: 'A' });
    const b = seedGame(fx.ctx, { title: 'B' });
    const sin = seedGame(fx.ctx, { title: 'Sin' });
    seedCuriosities(fx.ctx, { gameId: a, items: ['uno', 'dos'] });
    seedCuriosities(fx.ctx, { gameId: b, items: ['otro'] });
    assert.deepEqual(getGameCuriosities(fx.ctx, a), ['uno', 'dos']);
    assert.deepEqual(getGameCuriosities(fx.ctx, sin), []);
    tombstoneOnly(fx.ctx, 'games', b);
    assert.deepEqual(getGameCuriosities(fx.ctx, b), []);
    assert.deepEqual(getGameCuriosities(fx.ctx, 'no-existe'), []);
  });
});
