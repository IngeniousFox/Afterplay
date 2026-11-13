import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
  type SeedGameOptions,
} from '../../common/__tests__/fixtures';
import { readGameRow } from '../../common/gameView';
import { applyIgdbAdoption, selectAdoptionCandidates } from '../adoptIgdb';
import { failed } from '../types';
import {
  MANUAL_OVERRIDES,
  checkOf,
  countRows,
  detail,
  dirtyRows,
  gameRow,
  markClean,
  mdRow,
  overridesOf,
} from './helpers';

// La adopción de IGDB (`external/adoptIgdb.ts`) sobre el esquema 2.0.
// Referencia: `external/__tests__/adoptIgdb.test.ts`. La red se pasa como dato.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const soloSteam = (n: number, extra: Partial<SeedGameOptions> = {}): string =>
  seedGame(fx.ctx, {
    title: `Solo Steam ${n}`,
    steamAppId: 500 + n,
    steamAppIdSource: 'auto',
    ...extra,
  });

describe('candidatos', () => {
  it('vivos, sin igdbId y con appid; en orden de creación', () => {
    const a = soloSteam(1);
    fx.wall.advance(1);
    const b = soloSteam(2);
    seedGame(fx.ctx, { title: 'Con IGDB', igdbId: 7, steamAppId: 9 });
    seedGame(fx.ctx, { title: 'Sin nada' });
    const borrado = soloSteam(3);
    fx.ctx.store.remove('games', borrado);

    assert.deepEqual(selectAdoptionCandidates(fx.ctx), [
      { gameId: a, steamAppId: 501 },
      { gameId: b, steamAppId: 502 },
    ]);
  });
});

describe('applyIgdbAdoption', () => {
  it('se cambia de fuente entero: igdbId, título, caché completa y sellos; el id y la saveKey no cambian', () => {
    const gameId = soloSteam(1, { metadata: { summary: 'De la tienda', hltbMain: 10 } });
    const saveKeyBefore = gameRow(fx, gameId)?.saveKey;

    assert.equal(applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, detail(60_501)), 'adopted');

    const row = gameRow(fx, gameId);
    assert.equal(row?.id, gameId, 'ganar igdbId no cambia el id (§7.2, caso residual)');
    assert.equal(row?.igdbId, 60_501);
    assert.equal(row?.title, 'Ficha de IGDB 60501');
    assert.equal(row?.saveKey, saveKeyBefore, 'sus copias siguen bajo el prefijo antiguo (§12.7)');
    const md = mdRow(fx, gameId);
    assert.equal(md?.coverUrl, 'https://img.example/cover-60501.jpg');
    assert.equal(md?.heroUrl, 'https://img.example/hero-60501.jpg');
    assert.equal(md?.developer, 'Estudio IGDB');
    assert.deepEqual(md?.genres, ['Aventura']);
    assert.deepEqual(md?.officialPlatforms, ['PC (Microsoft Windows)']);
    assert.equal(md?.summary, 'Sinopsis de IGDB.');
    assert.equal(md?.releaseYear, 2023);
    assert.equal(md?.ratingCritics, 90);
    assert.equal(md?.hltbMain, 10, 'lo que IGDB no trae no se toca');
    assert.equal(checkOf(fx, gameId, 'igdb')?.status, 'ok');
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'ok');
    assert.deepEqual(selectAdoptionCandidates(fx.ctx), [], 'ya no es candidato');
  });

  it('R-01: pisa carátula, banner y textos anulando los overrides; las claves manuales no se tocan', () => {
    const gameId = soloSteam(1, {
      ...MANUAL_OVERRIDES,
      steamAppIdSource: 'manual',
      sgdbId: 777,
      sgdbIdSource: 'manual',
      notes: 'Mis notas',
    });

    applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, detail(60_501));

    assert.deepEqual(overridesOf(fx, gameId), {
      coverOverride: null,
      heroOverride: null,
      developerOverride: null,
      publisherOverride: null,
      genresOverride: null,
    });
    const view = readGameRow(fx.ctx, gameId);
    assert.equal(
      view?.coverUrl,
      'https://img.example/cover-60501.jpg',
      'lo que se ve es lo de IGDB',
    );
    const row = gameRow(fx, gameId);
    assert.equal(row?.steamAppId, 501);
    assert.equal(row?.steamAppIdSource, 'manual');
    assert.equal(row?.sgdbId, 777);
    assert.equal(row?.sgdbIdSource, 'manual');
    assert.equal(row?.notes, 'Mis notas');
  });

  it('sin carátula en IGDB deja la caché a null (mejor sin imagen que a medias); el año nunca a null', () => {
    const gameId = soloSteam(1, {
      metadata: { coverUrl: 'https://steam/cover.jpg', releaseYear: 2019 },
    });
    applyIgdbAdoption(
      fx.ctx,
      { gameId, steamAppId: 501 },
      detail(60_501, { covers: [], genres: [], releaseYear: null, release: null }),
    );
    const md = mdRow(fx, gameId);
    assert.equal(md?.coverUrl, null);
    assert.equal(md?.genres, null);
    assert.equal(md?.releaseYear, 2019);
  });

  it('IGDB sigue sin tenerlo: solo se apunta `igdb` empty; repetirlo no escribe (F-33)', () => {
    const gameId = soloSteam(1);
    markClean(fx);
    assert.equal(applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, null), 'not-found');
    assert.equal(gameRow(fx, gameId)?.igdbId, null);
    assert.equal(checkOf(fx, gameId, 'igdb')?.status, 'empty');
    assert.equal(mdRow(fx, gameId), undefined);

    markClean(fx);
    fx.wall.advance(60_000);
    applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, null);
    assert.equal(dirtyRows(fx), 0);
  });

  it('un fallo de uno en mitad del lote no afecta a los demás (cada uno, su transacción)', () => {
    const ids = [1, 2, 3, 4, 5].map((n) => soloSteam(n));
    const outcomes = ids.map((gameId, index) =>
      applyIgdbAdoption(
        fx.ctx,
        { gameId, steamAppId: 501 + index },
        index === 2 ? failed(new Error('IGDB 503')) : detail(60_501 + index),
      ),
    );
    assert.deepEqual(outcomes, ['adopted', 'adopted', 'failed', 'adopted', 'adopted']);
    assert.deepEqual(
      ids.map((id) => gameRow(fx, id)?.igdbId),
      [60_501, 60_502, null, 60_504, 60_505],
    );
    assert.equal(checkOf(fx, ids[2], 'igdb')?.error, 'IGDB 503');
  });

  it('un fallo no pisa un "no lo tengo" anterior', () => {
    const gameId = soloSteam(1);
    seedCheck(fx.ctx, { gameId, source: 'igdb', status: 'empty' });
    applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, failed('caído'));
    assert.equal(checkOf(fx, gameId, 'igdb')?.status, 'empty');
  });

  describe('relectura', () => {
    it('borrado durante la red: no recibe nada ni resucita filas (R-15)', () => {
      const gameId = soloSteam(1);
      fx.ctx.store.remove('games', gameId);
      assert.equal(
        applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, detail(60_501)),
        'skipped',
      );
      assert.equal(countRows(fx, 'game_metadata'), 0);
      assert.equal(countRows(fx, 'external_checks'), 0);
      assert.equal(gameRow(fx, gameId)?.igdbId, null);
    });

    it('ya ganó igdbId por otro camino: no se adopta otra vez', () => {
      const gameId = soloSteam(1);
      fx.ctx.store.patch('games', gameId, { igdbId: 42 });
      assert.equal(
        applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, detail(60_501)),
        'skipped',
      );
      assert.equal(gameRow(fx, gameId)?.igdbId, 42);
    });

    it('le cambiaste el appid a mano durante la red: el igdbId encontrado era de otro producto', () => {
      const gameId = soloSteam(1);
      fx.ctx.store.patch('games', gameId, { steamAppId: 999, steamAppIdSource: 'manual' });
      assert.equal(
        applyIgdbAdoption(fx.ctx, { gameId, steamAppId: 501 }, detail(60_501)),
        'skipped',
      );
      assert.equal(gameRow(fx, gameId)?.igdbId, null);
      assert.equal(mdRow(fx, gameId), undefined);
    });
  });
});
