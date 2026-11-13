import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { applySgdbResult, selectSgdbCandidates } from '../sgdbBackfill';
import {
  applySteamAppIdBackfill,
  selectSteamAppIdBackfillCandidates,
  type SteamAppIdBackfillCandidate,
} from '../steamAppIdBackfill';
import { failed } from '../types';
import {
  MANUAL_OVERRIDES,
  checkOf,
  countRows,
  dirtyRows,
  gameRow,
  markClean,
  mdRow,
  overridesOf,
} from './helpers';

// Las claves externas que se rellenan solas: el id de SteamGridDB
// (`external/sgdbBackfill.ts`, referencia `sgdbBackfill.test.ts`) y el appid
// de Steam del backfill de arranque (`steam/appIdBackfill.ts`). La red, las
// pausas y la válvula de "SGDB caído" siguen en el llamador.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('SteamGridDB', () => {
  it('candidatos: solo los que no tienen id; el elegido a mano no se pregunta jamás', () => {
    const sinId = seedGame(fx.ctx, {
      title: 'Sin arte todavía',
      steamAppId: 400,
      metadata: { releaseYear: 2025 },
    });
    seedGame(fx.ctx, { title: 'Elegido a mano', sgdbId: 777, sgdbIdSource: 'manual' });
    const sinMatch = seedGame(fx.ctx, { title: 'Que SGDB no conoce' });
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', borrado);

    const candidates = selectSgdbCandidates(fx.ctx, 'all');
    assert.deepEqual(candidates.map((c) => c.gameId).sort(), [sinId, sinMatch].sort());
    assert.deepEqual(
      candidates.find((c) => c.gameId === sinId),
      {
        gameId: sinId,
        title: 'Sin arte todavía',
        releaseYear: 2025,
        steamAppId: 400,
      },
    );
  });

  it('la puerta del Plan solo rellena planeados', () => {
    seedGame(fx.ctx, { title: 'De biblioteca' });
    const planeado = seedGame(fx.ctx, { title: 'Planeado', planned: true });
    assert.deepEqual(
      selectSgdbCandidates(fx.ctx, 'plan').map((c) => c.gameId),
      [planeado],
    );
  });

  it('escribe lo que encuentra como automático; el "no" deja marca y no lo saca de la lista', () => {
    const sinId = seedGame(fx.ctx, { title: 'Sin arte todavía', ...MANUAL_OVERRIDES });
    const sinMatch = seedGame(fx.ctx, { title: 'Que SGDB no conoce' });

    assert.equal(applySgdbResult(fx.ctx, sinId, 123), 'filled');
    assert.equal(applySgdbResult(fx.ctx, sinMatch, null), 'not-found');

    assert.equal(gameRow(fx, sinId)?.sgdbId, 123);
    assert.equal(gameRow(fx, sinId)?.sgdbIdSource, 'auto');
    assert.equal(checkOf(fx, sinId, 'sgdb')?.status, 'ok');
    assert.deepEqual(overridesOf(fx, sinId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
    assert.equal(checkOf(fx, sinMatch, 'sgdb')?.status, 'empty');
    assert.deepEqual(
      selectSgdbCandidates(fx.ctx, 'all').map((c) => c.gameId),
      [sinMatch],
      'ese "no" caduca: la próxima pasada vuelve a preguntar',
    );

    markClean(fx);
    applySgdbResult(fx.ctx, sinMatch, null);
    assert.equal(dirtyRows(fx), 0, 'F-33');
  });

  it('relectura: lo elegiste en el CoverPicker durante la red → no se pisa', () => {
    const gameId = seedGame(fx.ctx, { title: 'Carrera' });
    fx.ctx.store.patch('games', gameId, { sgdbId: 5, sgdbIdSource: 'manual' });
    assert.equal(applySgdbResult(fx.ctx, gameId, 6), 'skipped');
    assert.equal(gameRow(fx, gameId)?.sgdbId, 5);
    assert.equal(checkOf(fx, gameId, 'sgdb'), undefined);
  });

  it('borrado durante la red: nada (R-15); un fallo se apunta', () => {
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', borrado);
    assert.equal(applySgdbResult(fx.ctx, borrado, 6), 'skipped');
    assert.equal(countRows(fx, 'external_checks'), 0);

    const caido = seedGame(fx.ctx, { title: 'SGDB caído' });
    assert.equal(applySgdbResult(fx.ctx, caido, failed('timeout')), 'failed');
    assert.equal(checkOf(fx, caido, 'sgdb')?.status, 'error');
  });
});

describe('backfill del appid de Steam', () => {
  const candidateOf = (gameId: string): SteamAppIdBackfillCandidate => {
    const found = selectSteamAppIdBackfillCandidates(fx.ctx).find((c) => c.gameId === gameId);
    if (!found) throw new Error('no es candidato');
    return found;
  };

  it('candidatos: con igdbId, sin clave manual, nunca preguntados o con un fallo pendiente', () => {
    const nunca = seedGame(fx.ctx, { title: 'Nunca preguntado', igdbId: 1 });
    const fallo = seedGame(fx.ctx, { title: 'Falló', igdbId: 2 });
    seedCheck(fx.ctx, { gameId: fallo, source: 'steam_appid', status: 'error' });
    const respondido = seedGame(fx.ctx, { title: 'No está en Steam', igdbId: 3 });
    seedCheck(fx.ctx, { gameId: respondido, source: 'steam_appid', status: 'empty' });
    seedGame(fx.ctx, { title: 'Manual', igdbId: 4, steamAppId: 40, steamAppIdSource: 'manual' });
    seedGame(fx.ctx, { title: 'Sin IGDB' });

    assert.deepEqual(
      selectSteamAppIdBackfillCandidates(fx.ctx).map((c) => c.gameId),
      [nunca, fallo],
    );
  });

  it('apunta lo encontrado y lo no encontrado; después ya no son candidatos', () => {
    const enSteam = seedGame(fx.ctx, { title: 'En Steam', igdbId: 10, ...MANUAL_OVERRIDES });
    const fuera = seedGame(fx.ctx, { title: 'Fuera', igdbId: 11 });
    const applied = applySteamAppIdBackfill(fx.ctx, [
      { candidate: candidateOf(enSteam), appId: 100 },
      { candidate: candidateOf(fuera), appId: null },
    ]);
    assert.deepEqual(applied, { found: 1, empty: 1, skipped: 0, correctedGameIds: [] });
    assert.equal(gameRow(fx, enSteam)?.steamAppId, 100);
    assert.equal(gameRow(fx, enSteam)?.steamAppIdSource, 'auto');
    assert.equal(checkOf(fx, enSteam, 'steam_appid')?.status, 'ok');
    assert.equal(checkOf(fx, fuera, 'steam_appid')?.status, 'empty');
    assert.deepEqual(overridesOf(fx, enSteam), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
    assert.deepEqual(selectSteamAppIdBackfillCandidates(fx.ctx), []);
  });

  it('un "no está en Steam" nunca borra un appid que exista (la 1.x lo ponía a null)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Ya tenía',
      igdbId: 12,
      steamAppId: 120,
      steamAppIdSource: 'auto',
    });
    applySteamAppIdBackfill(fx.ctx, [{ candidate: candidateOf(gameId), appId: null }]);
    assert.equal(gameRow(fx, gameId)?.steamAppId, 120);
    assert.equal(checkOf(fx, gameId, 'steam_appid')?.status, 'empty');
  });

  it('relectura: fijado a mano o resuelto por otra vía durante la red → se salta entero', () => {
    const manual = seedGame(fx.ctx, { title: 'Manual a mitad', igdbId: 13 });
    const otraVia = seedGame(fx.ctx, { title: 'Otra vía', igdbId: 14 });
    const borrado = seedGame(fx.ctx, { title: 'Borrado', igdbId: 15 });
    const candidates = [manual, otraVia, borrado].map(candidateOf);
    fx.ctx.store.patch('games', manual, { steamAppId: 1, steamAppIdSource: 'manual' });
    fx.ctx.store.patch('games', otraVia, { steamAppId: 2, steamAppIdSource: 'auto' });
    fx.ctx.store.remove('games', borrado);

    const applied = applySteamAppIdBackfill(
      fx.ctx,
      candidates.map((candidate) => ({ candidate, appId: 999 })),
    );
    assert.equal(applied.skipped, 3);
    assert.equal(gameRow(fx, manual)?.steamAppId, 1);
    assert.equal(gameRow(fx, otraVia)?.steamAppId, 2);
    assert.equal(countRows(fx, 'external_checks'), 0);
  });

  it('un appid automático que cambia de producto tira lo de Steam y se devuelve para re-encolar', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Viejo',
      igdbId: 16,
      steamAppId: 160,
      steamAppIdSource: 'auto',
      metadata: { steamPositive: 10 },
    });
    const applied = applySteamAppIdBackfill(fx.ctx, [
      { candidate: candidateOf(gameId), appId: 161 },
    ]);
    assert.deepEqual(applied.correctedGameIds, [gameId]);
    assert.equal(gameRow(fx, gameId)?.steamAppId, 161);
    assert.equal(mdRow(fx, gameId)?.steamPositive, null);
  });
});
