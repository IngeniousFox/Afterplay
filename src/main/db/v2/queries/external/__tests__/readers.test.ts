import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { applyRadarMembership, selectRadarMembershipTargets } from '../radarMembership';
import { getExternalDataCounts } from '../status';
import { collectUsedImages } from '../usedImages';
import {
  MANUAL_OVERRIDES,
  batch,
  checkOf,
  dirtyRows,
  markClean,
  mdRow,
  overridesOf,
} from './helpers';

// `external:status`, `collectUsedImages` y la fase 1 del radar
// (`refreshMembership`, solo la parte que toca `games`).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getExternalDataCounts (external:status)', () => {
  it('cuenta sobre juegos vivos y su caché; "nunca preguntado" = sin respuesta de notas', () => {
    const completo = seedGame(fx.ctx, {
      title: 'Completo',
      steamAppId: 1,
      metadata: {
        ratingCritics: 80,
        summary: 'Sí',
        releaseDate: new Date('2020-01-01T00:00:00Z'),
        steamTags: [{ name: 'RPG', votes: 1 }],
        hltbCompletionist: 40,
      },
    });
    seedCheck(fx.ctx, { gameId: completo, source: 'igdb_ratings', status: 'ok' });
    const vacio = seedGame(fx.ctx, { title: 'Vacío' });
    seedCheck(fx.ctx, { gameId: vacio, source: 'igdb_ratings', status: 'empty' });
    const conFallo = seedGame(fx.ctx, { title: 'Falló', metadata: { ratingUsers: 70 } });
    seedCheck(fx.ctx, { gameId: conFallo, source: 'igdb_ratings', status: 'error' });
    seedGame(fx.ctx, { title: 'Nunca', metadata: { steamPositive: 3 } });
    const borrado = seedGame(fx.ctx, {
      title: 'Borrado',
      steamAppId: 2,
      metadata: { summary: 'x' },
    });
    fx.ctx.store.remove('games', borrado);

    assert.deepEqual(getExternalDataCounts(fx.ctx), {
      total: 4,
      withRatings: 2,
      withSummary: 1,
      withFullDate: 1,
      neverChecked: 2,
      steamEligible: 1,
      withSteamData: 2,
      withHltb: 1,
    });
  });

  it('base vacía: todo a cero', () => {
    assert.equal(getExternalDataCounts(fx.ctx).total, 0);
  });
});

describe('collectUsedImages', () => {
  it('override y caché de cada juego vivo, e iconos de catálogos de juegos vivos, sin repetir', () => {
    const conOverride = seedGame(fx.ctx, {
      title: 'Con override',
      coverOverride: 'https://img/mi-cover.jpg',
      metadata: { coverUrl: 'https://img/auto-cover.jpg', heroUrl: 'https://img/hero.jpg' },
    });
    seedGame(fx.ctx, {
      title: 'Comparte carátula',
      metadata: { coverUrl: 'https://img/auto-cover.jpg' },
    });
    seedCatalog(fx.ctx, {
      gameId: conOverride,
      items: [
        { apiName: 'A', iconUrl: 'https://img/a.jpg', iconGrayUrl: 'https://img/gris.jpg' },
        { apiName: 'B', iconUrl: 'https://img/b.jpg', iconGrayUrl: 'https://img/gris.jpg' },
        { apiName: 'C', iconUrl: null, iconGrayUrl: 'https://img/solo-gris.jpg' },
      ],
    });
    const borrado = seedGame(fx.ctx, {
      title: 'Borrado',
      metadata: { coverUrl: 'https://img/borrado.jpg' },
    });
    seedCatalog(fx.ctx, {
      gameId: borrado,
      items: [{ apiName: 'X', iconUrl: 'https://img/x.jpg' }],
    });
    fx.ctx.store.remove('games', borrado);

    assert.deepEqual(collectUsedImages(fx.ctx), [
      { url: 'https://img/mi-cover.jpg', type: 'covers' },
      { url: 'https://img/auto-cover.jpg', type: 'covers' },
      { url: 'https://img/hero.jpg', type: 'heroes' },
      { url: 'https://img/a.jpg', type: 'achievements' },
      { url: 'https://img/gris.jpg', type: 'achievements' },
      { url: 'https://img/b.jpg', type: 'achievements' },
    ]);
  });
});

describe('radar: refreshMembership', () => {
  it('objetivos: vivos con igdbId', () => {
    const a = seedGame(fx.ctx, { title: 'A', igdbId: 1 });
    seedGame(fx.ctx, { title: 'Solo Steam', steamAppId: 2 });
    const borrado = seedGame(fx.ctx, { title: 'Borrado', igdbId: 3 });
    fx.ctx.store.remove('games', borrado);
    assert.deepEqual(selectRadarMembershipTargets(fx.ctx), [{ gameId: a, igdbId: 1 }]);
  });

  it('guarda el lote como la pasada de biblioteca; salta los que IGDB no devolvió', () => {
    const a = seedGame(fx.ctx, { title: 'A', igdbId: 1, ...MANUAL_OVERRIDES });
    const b = seedGame(fx.ctx, { title: 'B', igdbId: 2 });
    const targets = selectRadarMembershipTargets(fx.ctx);
    assert.equal(applyRadarMembership(fx.ctx, targets, new Map([[1, batch()]])), 1);
    assert.deepEqual(mdRow(fx, a)?.igdbCollections, [{ id: 9, name: 'Saga inventada' }]);
    assert.equal(checkOf(fx, a, 'igdb_ratings')?.status, 'ok');
    assert.equal(
      checkOf(fx, b, 'igdb_ratings'),
      undefined,
      'su sello lo pone la pasada externa de después',
    );
    assert.deepEqual(overridesOf(fx, a), MANUAL_OVERRIDES);

    markClean(fx);
    applyRadarMembership(fx.ctx, targets, new Map([[1, batch()]]));
    assert.equal(dirtyRows(fx), 0, 'la semana siguiente con lo mismo no escribe (F-33)');
  });

  it('relectura: borrado durante la red → nada', () => {
    const a = seedGame(fx.ctx, { title: 'A', igdbId: 1 });
    const targets = selectRadarMembershipTargets(fx.ctx);
    fx.ctx.store.remove('games', a);
    assert.equal(applyRadarMembership(fx.ctx, targets, new Map([[1, batch()]])), 0);
    assert.equal(mdRow(fx, a), undefined);
  });
});
