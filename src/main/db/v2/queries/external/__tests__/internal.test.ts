import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { readLiveIdentity, recordCheck, writeMetadata } from '../internal';
import {
  MANUAL_OVERRIDES,
  checkOf,
  clocks,
  dirtyRows,
  markClean,
  mdRow,
  overridesOf,
} from './helpers';

// Las reglas comunes de P6: sellos (`recordCheck`) y caché (`writeMetadata`).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('recordCheck', () => {
  it('una respuesta repetida sin cadencia no se re-sella (F-33)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(recordCheck(fx.ctx, gameId, 'hltb', 'ok'), true);
    markClean(fx);
    const before = clocks(fx);
    fx.wall.advance(60_000);
    assert.equal(recordCheck(fx.ctx, gameId, 'hltb', 'ok'), false);
    assert.equal(dirtyRows(fx), 0);
    assert.equal(clocks(fx), before);
  });

  it('un cambio de respuesta sí se apunta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    recordCheck(fx.ctx, gameId, 'hltb', 'empty');
    fx.wall.advance(1000);
    assert.equal(recordCheck(fx.ctx, gameId, 'hltb', 'ok'), true);
    assert.equal(checkOf(fx, gameId, 'hltb')?.status, 'ok');
  });

  it('un fallo no pisa una respuesta anterior (en la 1.x un fallo no dejaba sello)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedCheck(fx.ctx, { gameId, source: 'igdb_ratings', status: 'ok' });
    assert.equal(recordCheck(fx.ctx, gameId, 'igdb_ratings', 'error', 'IGDB 503'), false);
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'ok');
  });

  it('un fallo sin respuesta previa sí se apunta, con su texto', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(recordCheck(fx.ctx, gameId, 'sgdb', 'error', 'timeout'), true);
    assert.equal(checkOf(fx, gameId, 'sgdb')?.error, 'timeout');
  });

  it('una respuesta con cadencia (ra_match sin set) se re-sella y mueve nextCheckAt', () => {
    const gameId = seedGame(fx.ctx, { title: 'Sonic' });
    recordCheck(fx.ctx, gameId, 'ra_match', 'empty');
    const first = checkOf(fx, gameId, 'ra_match')?.nextCheckAt?.getTime();
    fx.wall.advance(5_000);
    assert.equal(recordCheck(fx.ctx, gameId, 'ra_match', 'empty'), true);
    assert.equal(checkOf(fx, gameId, 'ra_match')?.nextCheckAt?.getTime(), (first ?? 0) + 5_000);
  });

  it('no deja nada de un juego borrado (R-15)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', gameId);
    assert.equal(recordCheck(fx.ctx, gameId, 'hltb', 'ok'), false);
    assert.equal(checkOf(fx, gameId, 'hltb'), undefined);
  });
});

describe('writeMetadata', () => {
  it('escribe solo los campos indicados y no toca los demás', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Celeste',
      metadata: { summary: 'vieja', hltbMain: 8 },
    });
    const current = readLiveIdentity(fx.ctx, gameId);
    assert.ok(current);
    writeMetadata(fx.ctx, current, { summary: 'nueva' });
    assert.equal(mdRow(fx, gameId)?.summary, 'nueva');
    assert.equal(mdRow(fx, gameId)?.hltbMain, 8);
  });

  it('lo mismo dos veces no escribe (F-33)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const current = readLiveIdentity(fx.ctx, gameId);
    assert.ok(current);
    writeMetadata(fx.ctx, current, { summary: 'x', genres: ['RPG'] });
    markClean(fx);
    writeMetadata(fx.ctx, current, { summary: 'x', genres: ['RPG'] });
    assert.equal(dirtyRows(fx), 0);
  });

  it('§19.5: un valor automático igual al override borra el override; uno distinto no', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', ...MANUAL_OVERRIDES });
    const current = readLiveIdentity(fx.ctx, gameId);
    assert.ok(current);
    writeMetadata(fx.ctx, current, {
      developer: 'Mi estudio', // igual que el override: no era una corrección
      genres: ['Mis géneros'], // igual (JSON)
      publisher: 'Otra editora', // distinta: el override manda
    });
    const overrides = overridesOf(fx, gameId);
    assert.equal(overrides.developerOverride, null);
    assert.equal(overrides.genresOverride, null);
    assert.equal(overrides.publisherOverride, 'Mi editora');
    assert.equal(overrides.coverOverride, MANUAL_OVERRIDES.coverOverride);
    assert.equal(mdRow(fx, gameId)?.developer, 'Mi estudio');
  });

  it('un null automático nunca borra un override', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste', ...MANUAL_OVERRIDES });
    const current = readLiveIdentity(fx.ctx, gameId);
    assert.ok(current);
    writeMetadata(fx.ctx, current, { developer: null, coverUrl: null });
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
  });
});
