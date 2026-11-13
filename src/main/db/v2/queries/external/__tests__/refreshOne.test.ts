import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCheck,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { applyHltbRefreshResult, readHltbRefreshTarget } from '../hltbRefresh';
import { applyRatingsRefreshResult } from '../refreshRatings';
import { applyRefreshGameResult } from '../refreshGame';
import { readExternalSnapshot, type ExternalSnapshot } from '../snapshot';
import { failed } from '../types';
import { applyWarmSteamData } from '../warmSteamData';
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

// Los refrescos de UN juego: "actualízalo todo" (`refreshGame.ts`), el ⟳ de
// notas (`refreshRatings.ts`), el ⟳ de HowLongToBeat (`ipc/hltb.ts`) y el
// calentado de Steam del alta (`warmNewGame.ts`). Referencias:
// `refreshGameHltb.test.ts` y la parte de `refreshRatings` de
// `refreshAppIdFix.test.ts`. La red se pasa como dato.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const snap = (gameId: string): ExternalSnapshot => {
  const snapshot = readExternalSnapshot(fx.ctx, gameId);
  if (!snapshot) throw new Error('sin foto');
  return snapshot;
};

const tiemposDe = (gameId: string): (number | null)[] => {
  const md = mdRow(fx, gameId);
  return [md?.hltbMain ?? null, md?.hltbMainExtras ?? null, md?.hltbCompletionist ?? null];
};

describe('readExternalSnapshot', () => {
  it('claves del juego y el año de la caché; null si está borrado', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Celeste',
      igdbId: 1,
      steamAppId: 2,
      steamAppIdSource: 'manual',
      metadata: { releaseYear: 2018 },
    });
    assert.deepEqual(snap(gameId), {
      gameId,
      title: 'Celeste',
      igdbId: 1,
      steamAppId: 2,
      steamAppIdSource: 'manual',
      sgdbId: null,
      sgdbIdSource: null,
      raGameId: null,
      releaseYear: 2018,
    });
    fx.ctx.store.remove('games', gameId);
    assert.equal(readExternalSnapshot(fx.ctx, gameId), null);
  });
});

describe('applyRefreshGameResult — HowLongToBeat (refreshGameHltb.test.ts)', () => {
  const conLosTres = (): string =>
    seedGame(fx.ctx, {
      title: 'Juego con tiempos de siempre',
      metadata: { hltbMain: 12, hltbMainExtras: 20, hltbCompletionist: 41 },
    });

  it('un match con un solo tramo actualiza ese y NO borra los otros dos', () => {
    const gameId = conLosTres();
    applyRefreshGameResult(fx.ctx, snap(gameId), {
      hltb: { hltbMain: 15, hltbMainExtras: null, hltbCompletionist: null },
    });
    assert.deepEqual(tiemposDe(gameId), [15, 20, 41]);
  });

  it('un match con los tres los escribe los tres', () => {
    const gameId = conLosTres();
    applyRefreshGameResult(fx.ctx, snap(gameId), {
      hltb: { hltbMain: 13, hltbMainExtras: 22, hltbCompletionist: 45 },
    });
    assert.deepEqual(tiemposDe(gameId), [13, 22, 45]);
  });

  it('sin match no se toca ni un tramo (y queda apuntado)', () => {
    const gameId = conLosTres();
    applyRefreshGameResult(fx.ctx, snap(gameId), { hltb: null });
    assert.deepEqual(tiemposDe(gameId), [12, 20, 41]);
    assert.equal(checkOf(fx, gameId, 'hltb')?.status, 'empty');
  });

  it('un juego que no tenía ninguno se queda solo con el tramo que HLTB sí supo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Huérfano' });
    applyRefreshGameResult(fx.ctx, snap(gameId), {
      hltb: { hltbMain: null, hltbMainExtras: null, hltbCompletionist: 60 },
    });
    assert.deepEqual(tiemposDe(gameId), [null, null, 60]);
  });
});

describe('applyRefreshGameResult', () => {
  it('escribe IGDB, appid, Steam y SteamGridDB en una transacción', () => {
    const gameId = seedGame(fx.ctx, { title: 'Todo', igdbId: 5 });
    const outcome = applyRefreshGameResult(fx.ctx, snap(gameId), {
      igdb: batch(),
      hltb: { hltbMain: 8, hltbMainExtras: null, hltbCompletionist: null },
      appId: { kind: 'found', appId: 50 },
      steam: { steamTags: [{ name: 'Indie', votes: 2 }], steamPositive: 4, steamNegative: 0 },
      sgdbId: 500,
    });
    assert.deepEqual(outcome, { status: 'applied', appIdChanged: 'found', discarded: [] });
    const row = gameRow(fx, gameId);
    assert.equal(row?.steamAppId, 50);
    assert.equal(row?.steamAppIdSource, 'auto');
    assert.equal(row?.sgdbId, 500);
    assert.equal(row?.sgdbIdSource, 'auto');
    const md = mdRow(fx, gameId);
    assert.equal(md?.ratingUsers, 77);
    assert.equal(md?.steamPositive, 4);
    for (const source of ['igdb_ratings', 'hltb', 'steam_appid', 'steam_store', 'sgdb'] as const) {
      assert.equal(checkOf(fx, gameId, source)?.status, 'ok', source);
    }
  });

  it('nunca escribe un override ni una clave manual (D-22, F-36)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Elegido a mano',
      igdbId: 6,
      steamAppId: 60,
      steamAppIdSource: 'manual',
      sgdbId: 600,
      sgdbIdSource: 'manual',
      ...MANUAL_OVERRIDES,
    });
    applyRefreshGameResult(fx.ctx, snap(gameId), {
      igdb: batch(),
      hltb: null,
      appId: { kind: 'corrected', appId: 61 },
      steam: { steamPositive: 1 },
      sgdbId: 601,
    });
    const row = gameRow(fx, gameId);
    assert.equal(row?.steamAppId, 60);
    assert.equal(row?.steamAppIdSource, 'manual');
    assert.equal(row?.sgdbId, 600);
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
  });

  it('lo mismo dos veces no escribe nada (F-33)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Estable',
      igdbId: 7,
      steamAppId: 70,
      steamAppIdSource: 'auto',
    });
    const result = {
      igdb: batch(),
      hltb: { hltbMain: 8, hltbMainExtras: 9, hltbCompletionist: 10 },
      steam: { steamPositive: 4, steamNegative: 1 },
    };
    applyRefreshGameResult(fx.ctx, snap(gameId), result);
    markClean(fx);
    const before = clocks(fx);
    fx.wall.advance(60_000);
    applyRefreshGameResult(fx.ctx, snap(gameId), result);
    assert.equal(dirtyRows(fx), 0);
    assert.equal(clocks(fx), before);
  });

  it('un fallo de IGDB no pisa las notas ni su sello anterior', () => {
    const gameId = seedGame(fx.ctx, { title: 'Caído', igdbId: 8, metadata: { ratingCritics: 70 } });
    seedCheck(fx.ctx, { gameId, source: 'igdb_ratings', status: 'ok' });
    applyRefreshGameResult(fx.ctx, snap(gameId), {
      igdb: failed('IGDB 503'),
      hltb: failed('HLTB 500'),
    });
    assert.equal(mdRow(fx, gameId)?.ratingCritics, 70);
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'ok');
    assert.equal(checkOf(fx, gameId, 'hltb')?.status, 'error');
  });

  it('not-on-steam deja marca sin tocar nada más', () => {
    const gameId = seedGame(fx.ctx, { title: 'De consola', igdbId: 9 });
    applyRefreshGameResult(fx.ctx, snap(gameId), { hltb: null, appId: { kind: 'not-on-steam' } });
    assert.equal(checkOf(fx, gameId, 'steam_appid')?.status, 'empty');
    assert.equal(gameRow(fx, gameId)?.steamAppId, null);
  });

  describe('relectura', () => {
    it('borrado durante la red: nada, ni filas resucitadas (R-15)', () => {
      const gameId = seedGame(fx.ctx, { title: 'Se borra', igdbId: 10 });
      const snapshot = snap(gameId);
      fx.ctx.store.remove('games', gameId);
      const outcome = applyRefreshGameResult(fx.ctx, snapshot, {
        igdb: batch(),
        hltb: { hltbMain: 1, hltbMainExtras: null, hltbCompletionist: null },
        sgdbId: 3,
      });
      assert.deepEqual(outcome, { status: 'gone' });
      assert.equal(countRows(fx, 'game_metadata'), 0);
      assert.equal(countRows(fx, 'external_checks'), 0);
    });

    it('elegiste un id de SteamGridDB durante la red: no se pisa', () => {
      const gameId = seedGame(fx.ctx, { title: 'CoverPicker', igdbId: 11 });
      const snapshot = snap(gameId);
      fx.ctx.store.patch('games', gameId, { sgdbId: 77, sgdbIdSource: 'manual' });
      const outcome = applyRefreshGameResult(fx.ctx, snapshot, { hltb: null, sgdbId: 88 });
      assert.equal(gameRow(fx, gameId)?.sgdbId, 77);
      assert.deepEqual(outcome.status === 'applied' && outcome.discarded, ['sgdb']);
    });

    it('fijaste el appid a mano durante la red: lo de Steam se descarta', () => {
      const gameId = seedGame(fx.ctx, { title: 'Fijado', igdbId: 12 });
      const snapshot = snap(gameId);
      fx.ctx.store.patch('games', gameId, { steamAppId: 120, steamAppIdSource: 'manual' });
      applyRefreshGameResult(fx.ctx, snapshot, {
        hltb: null,
        appId: { kind: 'found', appId: 121 },
        steam: { steamPositive: 3 },
      });
      assert.equal(gameRow(fx, gameId)?.steamAppId, 120);
      assert.equal(mdRow(fx, gameId)?.steamPositive ?? null, null);
    });
  });
});

describe('applyRatingsRefreshResult (refreshAppIdFix.test.ts, el ⟳ de notas)', () => {
  it('no sustituye un appid fijado a mano', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Manual',
      igdbId: 811,
      steamAppId: 123456,
      steamAppIdSource: 'manual',
      ...MANUAL_OVERRIDES,
    });
    const outcome = applyRatingsRefreshResult(fx.ctx, snap(gameId), {
      igdb: batch(),
      appId: { kind: 'corrected', appId: 999999 },
      reviews: null,
    });
    assert.equal(gameRow(fx, gameId)?.steamAppId, 123456);
    assert.equal(outcome.status === 'applied' && outcome.appIdChanged, null, 'nada que re-encolar');
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
  });

  it('corrige el appid, tira las reseñas del producto viejo (no las etiquetas) y pide re-encolar', () => {
    const remake = seedGame(fx.ctx, {
      title: 'Trails in the Sky 2nd Chapter',
      igdbId: 800,
      steamAppId: 251150,
      steamAppIdSource: 'auto',
      metadata: { steamPositive: 3000, steamNegative: 40, steamTags: [{ name: 'JRPG', votes: 9 }] },
    });
    const outcome = applyRatingsRefreshResult(fx.ctx, snap(remake), {
      igdb: batch(),
      appId: { kind: 'corrected', appId: 3005430 },
      reviews: null,
    });
    assert.equal(gameRow(fx, remake)?.steamAppId, 3005430);
    const md = mdRow(fx, remake);
    assert.equal(md?.steamPositive, null, 'las reseñas eran del juego de 2015');
    assert.equal(md?.steamNegative, null);
    assert.deepEqual(md?.steamTags, [{ name: 'JRPG', votes: 9 }], 'este botón no pide etiquetas');
    assert.equal(outcome.status === 'applied' && outcome.appIdChanged, 'corrected');
  });

  it('sin corrección, el appid se queda y las reseñas nuevas se escriben', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'De siempre',
      igdbId: 801,
      steamAppId: 400,
      steamAppIdSource: 'auto',
    });
    const outcome = applyRatingsRefreshResult(fx.ctx, snap(gameId), {
      igdb: batch(),
      reviews: { steamPositive: 5, steamNegative: 2 },
    });
    assert.equal(outcome.status === 'applied' && outcome.appIdChanged, null);
    assert.equal(mdRow(fx, gameId)?.steamPositive, 5);
    assert.equal(checkOf(fx, gameId, 'steam_store')?.status, 'ok');
  });

  it('IGDB ya no lo tiene: se conserva lo que había', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Desaparecido',
      igdbId: 802,
      metadata: { ratingCritics: 60 },
    });
    applyRatingsRefreshResult(fx.ctx, snap(gameId), { igdb: null });
    assert.equal(mdRow(fx, gameId)?.ratingCritics, 60);
    assert.equal(checkOf(fx, gameId, 'igdb_ratings')?.status, 'empty');
  });

  it('lo mismo dos veces no escribe nada (F-33)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Estable',
      igdbId: 803,
      steamAppId: 4,
      steamAppIdSource: 'auto',
    });
    const result = { igdb: batch(), reviews: { steamPositive: 5, steamNegative: 2 } };
    applyRatingsRefreshResult(fx.ctx, snap(gameId), result);
    markClean(fx);
    applyRatingsRefreshResult(fx.ctx, snap(gameId), result);
    assert.equal(dirtyRows(fx), 0);
  });

  it('borrado durante la red: nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Se borra', igdbId: 804 });
    const snapshot = snap(gameId);
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(applyRatingsRefreshResult(fx.ctx, snapshot, { igdb: batch() }), {
      status: 'gone',
    });
    assert.equal(countRows(fx, 'game_metadata'), 0);
  });
});

describe('hltb:refreshGame', () => {
  it('lee título y año; null si el juego no está', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades', metadata: { releaseYear: 2020 } });
    assert.deepEqual(readHltbRefreshTarget(fx.ctx, gameId), {
      gameId,
      title: 'Hades',
      releaseYear: 2020,
    });
    assert.equal(readHltbRefreshTarget(fx.ctx, 'no-existe'), null);
  });

  it('cambio a propósito: solo los tramos que HLTB supo (la 1.x escribía los null)', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Hades',
      metadata: { hltbMain: 20, hltbMainExtras: 30, hltbCompletionist: 90 },
    });
    assert.equal(
      applyHltbRefreshResult(fx.ctx, gameId, {
        hltbMain: 22,
        hltbMainExtras: null,
        hltbCompletionist: null,
      }),
      true,
    );
    assert.deepEqual(tiemposDe(gameId), [22, 30, 90]);
    assert.equal(checkOf(fx, gameId, 'hltb')?.status, 'ok');
  });

  it('sin match no se pisa nada; nunca toca overrides; borrado → false', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Hades',
      metadata: { hltbMain: 20 },
      ...MANUAL_OVERRIDES,
    });
    applyHltbRefreshResult(fx.ctx, gameId, null);
    assert.deepEqual(tiemposDe(gameId), [20, null, null]);
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
    fx.ctx.store.remove('games', gameId);
    markClean(fx);
    assert.equal(
      applyHltbRefreshResult(fx.ctx, gameId, {
        hltbMain: 1,
        hltbMainExtras: 2,
        hltbCompletionist: 3,
      }),
      false,
    );
    assert.equal(dirtyRows(fx), 0);
  });
});

describe('applyWarmSteamData (warmNewGame.ts)', () => {
  it('guarda etiquetas y reseñas del appid del alta y apunta la tienda', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Recién añadido',
      steamAppId: 10,
      steamAppIdSource: 'auto',
      ...MANUAL_OVERRIDES,
    });
    assert.equal(
      applyWarmSteamData(fx.ctx, gameId, 10, {
        steamTags: [{ name: 'Indie', votes: 1 }],
        steamPositive: 3,
      }),
      'written',
    );
    assert.deepEqual(mdRow(fx, gameId)?.steamTags, [{ name: 'Indie', votes: 1 }]);
    assert.equal(
      mdRow(fx, gameId)?.steamNegative ?? null,
      null,
      'lo que Steam no supo no se escribe',
    );
    assert.equal(checkOf(fx, gameId, 'steam_store')?.status, 'ok');
    assert.deepEqual(overridesOf(fx, gameId), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });

    markClean(fx);
    applyWarmSteamData(fx.ctx, gameId, 10, {
      steamTags: [{ name: 'Indie', votes: 1 }],
      steamPositive: 3,
    });
    assert.equal(dirtyRows(fx), 0, 'F-33');
  });

  it('el appid cambió justo después del alta, o el juego se borró: no escribe', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Cambiado',
      steamAppId: 10,
      steamAppIdSource: 'auto',
    });
    fx.ctx.store.patch('games', gameId, { steamAppId: 11, steamAppIdSource: 'manual' });
    assert.equal(applyWarmSteamData(fx.ctx, gameId, 10, { steamPositive: 3 }), 'skipped');
    fx.ctx.store.remove('games', gameId);
    assert.equal(applyWarmSteamData(fx.ctx, gameId, 11, { steamPositive: 3 }), 'skipped');
    assert.equal(countRows(fx, 'game_metadata'), 0);
  });

  it('Steam no supo nada: deja marca `empty` sin tocar la caché', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Sin datos',
      steamAppId: 12,
      steamAppIdSource: 'auto',
    });
    assert.equal(applyWarmSteamData(fx.ctx, gameId, 12, null), 'empty');
    assert.equal(mdRow(fx, gameId), undefined);
    assert.equal(checkOf(fx, gameId, 'steam_store')?.status, 'empty');
  });
});
