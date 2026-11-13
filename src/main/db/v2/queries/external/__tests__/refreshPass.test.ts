import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  applyRefreshPass,
  applyRefreshPassGame,
  needsAppIdLookup,
  needsAppIdReview,
  selectHltbOrphans,
  selectRefreshTargets,
  type RefreshTarget,
} from '../refreshPass';
import { failed } from '../types';
import {
  MANUAL_OVERRIDES,
  batch,
  checkOf,
  clocks,
  countRows,
  dirtyRows,
  gameRow,
  markClean,
  mdRow,
  overridesOf,
} from './helpers';

// La pasada de datos externos de la biblioteca (`external/refresh.ts`).
// Referencias: `refreshAppIdFix.test.ts` (parte de la pasada) y
// `refreshHltbOrphans.test.ts`. La red se pasa como dato; lo que allí era la
// orquestación (pausas, racha de fallos de HLTB, eventos) sigue en el
// llamador y no se porta aquí.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const targetOf = (gameId: string): RefreshTarget => {
  const found = selectRefreshTargets(fx.ctx, 'all').find((t) => t.gameId === gameId);
  if (!found) throw new Error('no es objetivo');
  return found;
};

describe('selectRefreshTargets', () => {
  it('"all" son todos los vivos; "plan", solo los planeados', () => {
    const a = seedGame(fx.ctx, { title: 'De biblioteca' });
    const p = seedGame(fx.ctx, { title: 'Planeado', planned: true });
    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', borrado);
    const promocionado = seedGame(fx.ctx, { title: 'Promocionado', planned: true });
    fx.ctx.store.remove('plan_entries', promocionado);

    assert.deepEqual(
      selectRefreshTargets(fx.ctx, 'all')
        .map((t) => t.gameId)
        .sort(),
      [a, p, promocionado].sort(),
    );
    assert.deepEqual(
      selectRefreshTargets(fx.ctx, 'plan').map((t) => t.gameId),
      [p],
    );
  });

  it('a quién se le busca o revisa el appid: nunca a una clave manual', () => {
    seedGame(fx.ctx, { title: 'Sin appid', igdbId: 1 });
    seedGame(fx.ctx, { title: 'Con appid', igdbId: 2, steamAppId: 20, steamAppIdSource: 'auto' });
    seedGame(fx.ctx, { title: 'Manual', igdbId: 3, steamAppId: 30, steamAppIdSource: 'manual' });
    seedGame(fx.ctx, { title: 'Sin IGDB', steamAppId: 40, steamAppIdSource: 'auto' });
    const targets = selectRefreshTargets(fx.ctx, 'all');
    assert.deepEqual(
      targets.filter(needsAppIdLookup).map((t) => t.title),
      ['Sin appid'],
    );
    assert.deepEqual(
      targets.filter(needsAppIdReview).map((t) => t.title),
      ['Con appid'],
    );
  });
});

describe('selectHltbOrphans (refreshHltbOrphans.test.ts)', () => {
  it('solo los que tienen los TRES tramos a null (o ninguna caché), con su año', () => {
    const huerfano = seedGame(fx.ctx, {
      title: 'Huérfano con suerte',
      metadata: { releaseYear: 2024 },
    });
    const sinCache = seedGame(fx.ctx, { title: 'Huérfano de nicho' });
    seedGame(fx.ctx, { title: 'Ya tenía', metadata: { hltbMain: 30 } });

    const orphans = selectHltbOrphans(fx.ctx, 'all');
    assert.deepEqual(orphans.map((o) => o.gameId).sort(), [huerfano, sinCache].sort());
    assert.equal(orphans.find((o) => o.gameId === huerfano)?.releaseYear, 2024);
  });

  it('la puerta del Plan solo repesca planeados', () => {
    seedGame(fx.ctx, { title: 'De biblioteca, huérfano' });
    const planeado = seedGame(fx.ctx, { title: 'Planeado huérfano', planned: true });
    assert.deepEqual(
      selectHltbOrphans(fx.ctx, 'plan').map((o) => o.gameId),
      [planeado],
    );
  });

  it('recortada a la foto: un alta a mitad de pasada no se pregunta', () => {
    const deSiempre = seedGame(fx.ctx, { title: 'Huérfano de siempre' });
    const foto = selectRefreshTargets(fx.ctx, 'all').map((t) => t.gameId);
    seedGame(fx.ctx, { title: 'Alta a mitad de pasada' });
    assert.deepEqual(
      selectHltbOrphans(fx.ctx, 'all', foto).map((o) => o.gameId),
      [deSiempre],
    );
  });
});

describe('applyRefreshPass', () => {
  it('escribe el lote de IGDB en la caché y apunta las notas; el año nunca se pone a null', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Con ficha',
      igdbId: 10,
      metadata: { releaseYear: 2020 },
    });
    applyRefreshPass(fx.ctx, [{ target: targetOf(gameId), igdb: batch({ releaseYear: null }) }]);
    const md = mdRow(fx, gameId);
    assert.equal(md?.ratingCritics, 81);
    assert.equal(md?.summary, 'Una sinopsis inventada.');
    assert.deepEqual(md?.igdbCollections, [{ id: 9, name: 'Saga inventada' }]);
    assert.equal(md?.releaseYear, 2020);
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'ok');
  });

  it('IGDB no lo devolvió: se apunta sin pisar lo que había', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Desaparecido',
      igdbId: 11,
      metadata: { summary: 'vieja' },
    });
    applyRefreshPass(fx.ctx, [{ target: targetOf(gameId), igdb: null }]);
    assert.equal(mdRow(fx, gameId)?.summary, 'vieja');
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'empty');
  });

  it('una pasada que trae lo mismo no escribe nada (F-33)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Estable',
      igdbId: 12,
      steamAppId: 120,
      steamAppIdSource: 'auto',
    });
    const item = {
      target: targetOf(gameId),
      igdb: batch(),
      steam: { steamTags: [{ name: 'RPG', votes: 3 }], steamPositive: 10, steamNegative: 1 },
      hltb: { hltbMain: 5, hltbMainExtras: null, hltbCompletionist: null },
    };
    applyRefreshPass(fx.ctx, [item]);
    markClean(fx);
    const before = clocks(fx);
    fx.wall.advance(7 * 24 * 60 * 60 * 1000);

    applyRefreshPass(fx.ctx, [{ ...item, target: targetOf(gameId), hltb: undefined }]);

    assert.equal(dirtyRows(fx), 0, 'ni games, ni caché, ni sellos pendientes de sync');
    assert.equal(clocks(fx), before, 'ningún syncUpdated se mueve');
  });

  it('nunca escribe un override ni una clave manual (D-22, F-36)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Elegido a mano',
      igdbId: 710,
      steamAppId: 123456,
      steamAppIdSource: 'manual',
      sgdbId: 5,
      sgdbIdSource: 'manual',
      ...MANUAL_OVERRIDES,
    });
    const result = applyRefreshPass(fx.ctx, [
      {
        target: targetOf(gameId),
        igdb: batch(),
        appId: { kind: 'corrected', appId: 999999 },
        steam: { steamPositive: 1 },
      },
    ]);
    const row = gameRow(fx, gameId);
    assert.equal(row?.steamAppId, 123456);
    assert.equal(row?.steamAppIdSource, 'manual');
    assert.equal(row?.sgdbId, 5);
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
    assert.deepEqual(result.correctedGameIds, [], 'nada que re-encolar');
  });

  it('appid corregido: tira lo del producto viejo, apunta y lo devuelve para re-encolar logros', () => {
    const remake = seedGame(fx.ctx, {
      title: 'Trails in the Sky 2nd Chapter',
      igdbId: 700,
      steamAppId: 251150,
      steamAppIdSource: 'auto',
      metadata: {
        steamTags: [{ name: 'JRPG', votes: 900 }],
        steamPositive: 3000,
        steamNegative: 50,
      },
    });
    seedCheck(fx.ctx, { gameId: remake, source: 'steam_achievements', status: 'ok' });
    seedCheck(fx.ctx, { gameId: remake, source: 'steam_unlocks', status: 'ok' });

    const result = applyRefreshPass(fx.ctx, [
      {
        target: targetOf(remake),
        igdb: batch(),
        appId: { kind: 'corrected', appId: 3005430 },
        // La página existe (hay etiquetas) pero aún no tiene reseñas.
        steam: { steamTags: [{ name: 'Remake', votes: 4 }] },
      },
    ]);

    const row = gameRow(fx, remake);
    assert.equal(row?.steamAppId, 3005430);
    assert.equal(row?.steamAppIdSource, 'auto');
    const md = mdRow(fx, remake);
    assert.deepEqual(md?.steamTags, [{ name: 'Remake', votes: 4 }]);
    assert.equal(md?.steamPositive, null, 'las tres mil reseñas eran del juego de 2015');
    assert.equal(md?.steamNegative, null);
    assert.equal(checkOf(fx, remake, 'steam_appid')?.status, 'ok');
    assert.equal(
      checkOf(fx, remake, 'steam_achievements'),
      undefined,
      'los logros vuelven a estar pendientes',
    );
    assert.equal(checkOf(fx, remake, 'steam_unlocks'), undefined);
    assert.deepEqual(result.correctedGameIds, [remake]);
  });

  it('sin correcciones no hay nada que re-encolar', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'De siempre',
      igdbId: 701,
      steamAppId: 400,
      steamAppIdSource: 'auto',
    });
    const result = applyRefreshPass(fx.ctx, [
      { target: targetOf(gameId), igdb: batch(), steam: null },
    ]);
    assert.deepEqual(result.correctedGameIds, []);
    assert.equal(gameRow(fx, gameId)?.steamAppId, 400);
    assert.equal(checkOf(fx, gameId, 'steam_store')?.status, 'empty');
  });

  it('appid encontrado: automático, apuntado, y lo de Steam de ese appid en la misma vuelta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Recién salido', igdbId: 13 });
    const result = applyRefreshPass(fx.ctx, [
      {
        target: targetOf(gameId),
        igdb: batch(),
        appId: { kind: 'found', appId: 1300 },
        steam: { steamPositive: 99, steamNegative: 1 },
      },
    ]);
    assert.equal(gameRow(fx, gameId)?.steamAppId, 1300);
    assert.equal(gameRow(fx, gameId)?.steamAppIdSource, 'auto');
    assert.equal(mdRow(fx, gameId)?.steamPositive, 99);
    assert.equal(checkOf(fx, gameId, 'steam_store')?.status, 'ok');
    const outcome = result.games.get(gameId);
    assert.equal(outcome?.status === 'applied' && outcome.appIdChanged, 'found');
  });

  it('sigue sin estar en Steam: `steam_appid` empty, sin tocar nada más', () => {
    const gameId = seedGame(fx.ctx, { title: 'De consola', igdbId: 14 });
    applyRefreshPass(fx.ctx, [
      { target: targetOf(gameId), igdb: batch(), appId: { kind: 'not-on-steam' } },
    ]);
    assert.equal(gameRow(fx, gameId)?.steamAppId, null);
    assert.equal(checkOf(fx, gameId, 'steam_appid')?.status, 'empty');
  });

  it('repesca de HLTB: escribe el match, el no-match queda null y apuntado', () => {
    const conSuerte = seedGame(fx.ctx, { title: 'Huérfano con suerte' });
    const deNicho = seedGame(fx.ctx, { title: 'Huérfano de nicho' });
    applyRefreshPass(fx.ctx, [
      {
        target: targetOf(conSuerte),
        igdb: null,
        hltb: { hltbMain: 12, hltbMainExtras: 20, hltbCompletionist: 41 },
      },
      { target: targetOf(deNicho), igdb: null, hltb: null },
    ]);
    assert.equal(mdRow(fx, conSuerte)?.hltbCompletionist, 41);
    assert.equal(checkOf(fx, conSuerte, 'hltb')?.status, 'ok');
    assert.equal(mdRow(fx, deNicho)?.hltbMain ?? null, null);
    assert.equal(checkOf(fx, deNicho, 'hltb')?.status, 'empty');
    assert.deepEqual(
      selectHltbOrphans(fx.ctx, 'all').map((o) => o.gameId),
      [deNicho],
      'el "no" de HLTB no lo saca de la repesca: se reintenta en la próxima pasada',
    );
  });

  it('un fallo de HLTB se apunta como fallo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Huérfano' });
    applyRefreshPass(fx.ctx, [
      { target: targetOf(gameId), igdb: null, hltb: failed('HLTB caído') },
    ]);
    assert.equal(checkOf(fx, gameId, 'hltb')?.status, 'error');
  });

  describe('relectura (minutos de red entre la foto y la escritura)', () => {
    it('borrado durante la pasada: no recibe nada ni resucita filas (R-15)', () => {
      const gameId = seedGame(fx.ctx, { title: 'Se borra', igdbId: 20 });
      const target = targetOf(gameId);
      fx.ctx.store.remove('games', gameId);
      const result = applyRefreshPass(fx.ctx, [
        {
          target,
          igdb: batch(),
          hltb: { hltbMain: 1, hltbMainExtras: null, hltbCompletionist: null },
        },
      ]);
      assert.equal(result.games.get(gameId)?.status, 'gone');
      assert.equal(countRows(fx, 'game_metadata'), 0);
      assert.equal(countRows(fx, 'external_checks'), 0);
    });

    it('fijaste el appid a mano durante la pasada: lo de Steam se descarta, lo de IGDB no', () => {
      const gameId = seedGame(fx.ctx, {
        title: 'Cambia',
        igdbId: 21,
        steamAppId: 210,
        steamAppIdSource: 'auto',
      });
      const target = targetOf(gameId);
      fx.ctx.store.patch('games', gameId, { steamAppId: 211, steamAppIdSource: 'manual' });

      const result = applyRefreshPass(fx.ctx, [
        {
          target,
          igdb: batch(),
          appId: { kind: 'corrected', appId: 999 },
          steam: { steamPositive: 7 },
        },
      ]);

      assert.equal(gameRow(fx, gameId)?.steamAppId, 211);
      assert.equal(mdRow(fx, gameId)?.steamPositive ?? null, null);
      assert.equal(mdRow(fx, gameId)?.ratingCritics, 81, 'lo de IGDB sí se escribe');
      const outcome = result.games.get(gameId);
      assert.deepEqual(outcome?.status === 'applied' && outcome.discarded, ['steam']);
    });

    it('otro camino le encontró un appid durante la pasada: el "encontrado" de la foto no lo pisa', () => {
      const gameId = seedGame(fx.ctx, { title: 'Doble', igdbId: 22 });
      const target = targetOf(gameId);
      fx.ctx.store.patch('games', gameId, { steamAppId: 220, steamAppIdSource: 'auto' });
      applyRefreshPass(fx.ctx, [{ target, igdb: null, appId: { kind: 'found', appId: 221 } }]);
      assert.equal(gameRow(fx, gameId)?.steamAppId, 220);
    });

    it('ganó otro igdbId durante la pasada (adopción): el lote de la foto se descarta', () => {
      const gameId = seedGame(fx.ctx, {
        title: 'Adoptado',
        steamAppId: 230,
        steamAppIdSource: 'auto',
      });
      const target = targetOf(gameId);
      fx.ctx.store.patch('games', gameId, { igdbId: 23 });
      applyRefreshPassGame(fx.ctx, { target, igdb: null });
      assert.equal(checkOf(fx, gameId, 'igdb_ratings'), undefined);
    });

    it('el botón de la ficha le encontró tiempos durante la pasada: la repesca no los pisa', () => {
      const gameId = seedGame(fx.ctx, { title: 'Ya no es huérfano' });
      const target = targetOf(gameId);
      fx.ctx.store.create('game_metadata', { gameId, hltbMain: 30 });
      applyRefreshPass(fx.ctx, [
        { target, igdb: null, hltb: { hltbMain: 9, hltbMainExtras: null, hltbCompletionist: 50 } },
      ]);
      assert.equal(mdRow(fx, gameId)?.hltbMain, 30);
      assert.equal(mdRow(fx, gameId)?.hltbCompletionist, null);
    });
  });
});
