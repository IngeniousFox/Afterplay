import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { achievementCatalogId } from '../../../../../../shared/sync/ids';
import {
  openQueryDb,
  seedCatalog,
  seedGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { readCheck } from '../../common/checks';
import {
  fillHiddenDescriptions,
  getGoldbergCatalogItems,
  readCatalogItems,
  storeRaCatalog,
  storeSteamCatalog,
  type RaCatalogDefinition,
  type SteamCatalogDefinition,
} from '../catalog';
import { storeRaProgress } from '../raSync';
import { storeUnlocks } from '../storeUnlocks';
import { storedFor, syncUpdatedOf } from './helpers';

// La escritura del catálogo agrupado (una fila JSON por juego y fuente).
// Porta los casos de base de src/main/steam/__tests__/syncGameAchievements.test.ts
// (qué se da por sincronizado y qué no, la guarda del appid) y del catálogo de
// goldbergCatalog.test.ts; la red y el disco no son de este paquete.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const def = (
  apiName: string,
  sortIndex = 0,
  extra: Partial<SteamCatalogDefinition> = {},
): SteamCatalogDefinition => ({
  apiName,
  displayName: `Logro ${apiName}`,
  description: 'Lo que hay que hacer',
  iconUrl: null,
  iconGrayUrl: null,
  hidden: false,
  sortIndex,
  ...extra,
});

const steamGame = (appId = 440): string =>
  seedGame(fx.ctx, { title: 'Juego de prueba', steamAppId: appId });
const apiNames = (gameId: string, source: 'steam' | 'ra' = 'steam'): string[] =>
  readCatalogItems(fx.ctx, gameId, source)
    .map((item) => item.apiName)
    .sort();
const steamCheck = (gameId: string): string | null =>
  readCheck(fx.ctx, gameId, 'steam_achievements')?.status ?? null;

describe('storeSteamCatalog: un catálogo vacío no siempre significa lo mismo', () => {
  it('no escribe una respuesta en vuelo para el appid anterior', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Corregido',
      steamAppId: 441,
      steamAppIdSource: 'manual',
    });
    const result = storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('OLD_WIN')],
      percentages: new Map([['OLD_WIN', 10]]),
    });
    assert.deepEqual(result, { status: 'stale' });
    assert.deepEqual(apiNames(gameId), []);
    assert.equal(steamCheck(gameId), null);
  });

  it('una clave inválida NO marca el juego como sincronizado, y al corregirla se recupera solo', () => {
    const gameId = steamGame();
    const percentages = new Map([
      ['TF_SCOUT', 34.2],
      ['TF_SOLDIER', 21.5],
    ]);
    assert.deepEqual(
      storeSteamCatalog(fx.ctx, { gameId, appId: 440, definitions: [], percentages }),
      {
        status: 'unconfirmed',
      },
    );
    assert.deepEqual(apiNames(gameId), []);
    assert.equal(steamCheck(gameId), null);

    const segunda = storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('TF_SCOUT', 0), def('TF_SOLDIER', 1)],
      percentages,
    });
    assert.deepEqual(segunda, { status: 'stored', written: true, count: 2 });
    assert.deepEqual(apiNames(gameId), ['TF_SCOUT', 'TF_SOLDIER']);
    assert.equal(steamCheck(gameId), 'ok');
  });

  it('un juego con stats y CERO logros sí se marca: ahí el vacío es la respuesta (sin fila vacía)', () => {
    const gameId = steamGame();
    const result = storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [],
      percentages: new Map(),
    });
    assert.deepEqual(result, { status: 'stored', written: false, count: 0 });
    assert.deepEqual(apiNames(gameId), []);
    assert.equal(steamCheck(gameId), 'empty');
  });

  it('un juego que todavía no ha salido no se marca', () => {
    const gameId = steamGame();
    assert.equal(
      storeSteamCatalog(fx.ctx, { gameId, appId: 440, definitions: [], percentages: null }).status,
      'unconfirmed',
    );
    assert.equal(steamCheck(gameId), null);
  });

  it('con catálogo de verdad se guardan los logros, su rareza y el sello', () => {
    const gameId = steamGame();
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('TF_SCOUT', 0), def('TF_SOLDIER', 1)],
      percentages: new Map([['TF_SCOUT', 34.2]]),
    });
    const [scout, soldier] = readCatalogItems(fx.ctx, gameId, 'steam');
    assert.equal(scout.globalPercent, 34.2);
    assert.equal(scout.displayName, 'Logro TF_SCOUT');
    assert.equal(soldier.globalPercent, null);
    assert.equal(steamCheck(gameId), 'ok');
  });

  it('un juego borrado no recibe catálogo (R-15)', () => {
    const gameId = steamGame();
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(
      storeSteamCatalog(fx.ctx, { gameId, appId: 440, definitions: [def('A')], percentages: null }),
      { status: 'stale' },
    );
  });
});

describe('storeSteamCatalog: fusión en memoria y "solo si cambia"', () => {
  it('la misma respuesta otra vez no escribe la fila (aunque cambie la hora)', () => {
    const gameId = steamGame();
    const input = {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('B', 1)],
      percentages: new Map([['A', 5]]),
    };
    storeSteamCatalog(fx.ctx, input);
    const id = achievementCatalogId(gameId, 'steam');
    const before = syncUpdatedOf(fx.ctx, 'achievement_catalogs', id);
    fx.wall.advance(60_000);
    assert.deepEqual(storeSteamCatalog(fx.ctx, input), {
      status: 'stored',
      written: false,
      count: 2,
    });
    assert.equal(syncUpdatedOf(fx.ctx, 'achievement_catalogs', id), before);
  });

  it('la misma respuesta en otro ORDEN tampoco escribe: la lista se guarda en orden canónico', () => {
    const gameId = steamGame();
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('B', 1)],
      percentages: null,
    });
    const result = storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('B', 1), def('A', 0)],
      percentages: null,
    });
    assert.equal(result.status === 'stored' && result.written, false);
  });

  it('un cambio de orden de verdad (sortIndex) sí escribe', () => {
    const gameId = steamGame();
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('B', 1)],
      percentages: null,
    });
    const result = storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 1), def('B', 0)],
      percentages: null,
    });
    assert.equal(result.status === 'stored' && result.written, true);
    assert.deepEqual(
      readCatalogItems(fx.ctx, gameId, 'steam').map((item) => item.apiName),
      ['B', 'A'],
    );
  });

  it('conserva la descripción guardada cuando la API manda null (los ocultos)', () => {
    const gameId = steamGame();
    seedCatalog(fx.ctx, {
      gameId,
      items: [{ apiName: 'SECRET', hidden: true, description: 'Del schema local' }],
    });
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('SECRET', 0, { hidden: true, description: null })],
      percentages: null,
    });
    assert.equal(readCatalogItems(fx.ctx, gameId, 'steam')[0].description, 'Del schema local');
  });

  it('conserva la rareza si su llamada falló; con llamada, la pisa (null si no viene)', () => {
    const gameId = steamGame();
    seedCatalog(fx.ctx, {
      gameId,
      items: [
        { apiName: 'A', globalPercent: 12 },
        { apiName: 'B', globalPercent: 30 },
      ],
    });
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('B', 1)],
      percentages: null,
    });
    assert.deepEqual(
      readCatalogItems(fx.ctx, gameId, 'steam').map((item) => item.globalPercent),
      [12, 30],
    );
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('B', 1)],
      percentages: new Map([['A', 8]]),
    });
    assert.deepEqual(
      readCatalogItems(fx.ctx, gameId, 'steam').map((item) => item.globalPercent),
      [8, null],
    );
  });

  it('un logro que ya no viene no se borra (la 1.x nunca borraba filas del catálogo)', () => {
    const gameId = steamGame();
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0), def('RETIRADO', 1)],
      percentages: null,
    });
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('A', 0)],
      percentages: null,
    });
    assert.deepEqual(apiNames(gameId), ['A', 'RETIRADO']);
  });

  it('los iconos que apuntan a un directorio se guardan como null', () => {
    const gameId = steamGame();
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [
        def('A', 0, { iconUrl: 'https://cdn/apps/440/', iconGrayUrl: 'https://cdn/a.jpg' }),
      ],
      percentages: null,
    });
    const [item] = readCatalogItems(fx.ctx, gameId, 'steam');
    assert.equal(item.iconUrl, null);
    assert.equal(item.iconGrayUrl, 'https://cdn/a.jpg');
  });

  it('tras cambiar el appid (catálogo con lápida) no se mezcla con lo del producto viejo', () => {
    const gameId = steamGame(100);
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 100,
      definitions: [def('WRONG')],
      percentages: null,
    });
    // Lo que hará setSteamAppId (P2): lápida al catálogo de Steam y nuevo appid.
    fx.ctx.store.remove('achievement_catalogs', achievementCatalogId(gameId, 'steam'));
    fx.ctx.store.patch('games', gameId, { steamAppId: 440, steamAppIdSource: 'manual' });
    storeSteamCatalog(fx.ctx, {
      gameId,
      appId: 440,
      definitions: [def('CRACK_WIN'), def('STEAM_WIN', 1)],
      percentages: new Map([
        ['CRACK_WIN', 12],
        ['STEAM_WIN', 30],
      ]),
    });
    assert.deepEqual(apiNames(gameId), ['CRACK_WIN', 'STEAM_WIN']);
    // Y los desbloqueos de las dos vías entran contra el appid nuevo.
    storeUnlocks(fx.ctx, {
      gameId,
      feed: 'emu',
      unlocks: [{ apiName: 'CRACK_WIN', unlockedAt: new Date('2026-01-01') }],
      fallbackDate: new Date('2026-01-03'),
      expectedAppId: 440,
    });
    storeUnlocks(fx.ctx, {
      gameId,
      feed: 'steam',
      unlocks: [{ apiName: 'STEAM_WIN', unlockedAt: new Date('2026-01-02') }],
      fallbackDate: new Date('2026-01-03'),
      expectedAppId: 440,
    });
    assert.deepEqual(
      storedFor(fx.ctx, gameId)
        .map((row) => row.origin.split('@')[0])
        .sort(),
      ['emu', 'steam'],
    );
  });
});

describe('fillHiddenDescriptions', () => {
  it('rellena solo los ocultos cuyo texto cambia, y no escribe si nada cambia', () => {
    const gameId = steamGame();
    seedCatalog(fx.ctx, {
      gameId,
      items: [
        { apiName: 'SECRET', hidden: true },
        { apiName: 'VISIBLE', description: 'Visible' },
        { apiName: 'SECRET_2', hidden: true, description: 'Ya estaba' },
      ],
    });
    const texts = new Map([
      ['SECRET', { description: 'Mata al dragón' }],
      ['VISIBLE', { description: 'Otro texto' }],
      ['SECRET_2', { description: 'Ya estaba' }],
    ]);
    assert.equal(fillHiddenDescriptions(fx.ctx, gameId, 440, texts), 1);
    const items = readCatalogItems(fx.ctx, gameId, 'steam');
    assert.equal(items.find((i) => i.apiName === 'SECRET')?.description, 'Mata al dragón');
    assert.equal(items.find((i) => i.apiName === 'VISIBLE')?.description, 'Visible');
    const id = achievementCatalogId(gameId, 'steam');
    const before = syncUpdatedOf(fx.ctx, 'achievement_catalogs', id);
    assert.equal(fillHiddenDescriptions(fx.ctx, gameId, 440, texts), 0);
    assert.equal(syncUpdatedOf(fx.ctx, 'achievement_catalogs', id), before);
  });

  it('con otro appid, o un texto vacío, no toca nada', () => {
    const gameId = steamGame();
    seedCatalog(fx.ctx, { gameId, items: [{ apiName: 'SECRET', hidden: true }] });
    assert.equal(
      fillHiddenDescriptions(fx.ctx, gameId, 441, new Map([['SECRET', { description: 'x' }]])),
      0,
    );
    assert.equal(
      fillHiddenDescriptions(fx.ctx, gameId, 440, new Map([['SECRET', { description: '' }]])),
      0,
    );
    assert.equal(readCatalogItems(fx.ctx, gameId, 'steam')[0].description, null);
  });
});

const raDef = (
  id: number,
  sortIndex: number,
  extra: Partial<RaCatalogDefinition> = {},
): RaCatalogDefinition => ({
  apiName: String(id),
  displayName: `RA ${id}`,
  description: `Descripción ${id}`,
  iconUrl: `https://media.retroachievements.org/Badge/${id}.png`,
  iconGrayUrl: `https://media.retroachievements.org/Badge/${id}_lock.png`,
  globalPercent: 10,
  sortIndex,
  ...extra,
});

describe('storeRaCatalog y storeRaProgress', () => {
  it('relee raGameId: una respuesta del set anterior no se escribe', () => {
    const gameId = seedGame(fx.ctx, { title: 'Mario', raGameId: 2 });
    assert.deepEqual(storeRaCatalog(fx.ctx, { gameId, raGameId: 1, definitions: [raDef(1, 0)] }), {
      status: 'stale',
    });
    assert.deepEqual(apiNames(gameId, 'ra'), []);
  });

  it('catálogo, sello y desbloqueos en una sola escritura; los nuevos se devuelven', () => {
    const gameId = seedGame(fx.ctx, { title: 'Mario', raGameId: 2 });
    const result = storeRaProgress(fx.ctx, {
      gameId,
      raGameId: 2,
      definitions: [
        { ...raDef(10, 0), earnedAt: new Date('2026-02-01T19:30:00Z') },
        { ...raDef(11, 1), earnedAt: null },
      ],
    });
    assert.equal(result.status, 'stored');
    if (result.status !== 'stored') return;
    assert.equal(result.catalogCount, 2);
    assert.equal(result.unlockedCount, 1);
    assert.deepEqual(
      result.fresh.map((toast) => toast.displayName),
      ['RA 10'],
    );
    assert.deepEqual(apiNames(gameId, 'ra'), ['10', '11']);
    assert.equal(readCheck(fx.ctx, gameId, 'ra_achievements')?.status, 'ok');
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.source, row.origin, row.apiName]),
      [['ra', 'ra', '10']],
    );
    // Repetirla no anuncia nada ni reescribe el catálogo.
    const id = achievementCatalogId(gameId, 'ra');
    const before = syncUpdatedOf(fx.ctx, 'achievement_catalogs', id);
    const again = storeRaProgress(fx.ctx, {
      gameId,
      raGameId: 2,
      definitions: [
        { ...raDef(10, 0), earnedAt: new Date('2026-02-01T19:30:00Z') },
        { ...raDef(11, 1), earnedAt: null },
      ],
    });
    assert.equal(again.status === 'stored' && again.fresh.length, 0);
    assert.equal(syncUpdatedOf(fx.ctx, 'achievement_catalogs', id), before);
  });

  it('en RA la respuesta manda en la descripción (no hay ocultos)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Mario', raGameId: 2 });
    storeRaCatalog(fx.ctx, { gameId, raGameId: 2, definitions: [raDef(10, 0)] });
    storeRaCatalog(fx.ctx, {
      gameId,
      raGameId: 2,
      definitions: [raDef(10, 0, { description: null })],
    });
    assert.equal(readCatalogItems(fx.ctx, gameId, 'ra')[0].description, null);
  });
});

describe('getGoldbergCatalogItems', () => {
  it('solo el catálogo de Steam, con hidden; nada del de RA', () => {
    const gameId = seedGame(fx.ctx, { title: 'Elliot', steamAppId: 440, raGameId: 3 });
    seedCatalog(fx.ctx, {
      gameId,
      items: [
        { apiName: 'ACH_FIRST_STEP', displayName: 'First step' },
        { apiName: 'ACH_SECRET', hidden: true },
      ],
    });
    seedCatalog(fx.ctx, { gameId, source: 'ra', items: [{ apiName: '123' }] });
    assert.deepEqual(getGoldbergCatalogItems(fx.ctx, gameId), [
      { apiName: 'ACH_FIRST_STEP', displayName: 'First step', description: null, hidden: false },
      { apiName: 'ACH_SECRET', displayName: 'ACH_SECRET', description: null, hidden: true },
    ]);
  });

  it('sin catálogo o con el juego borrado, vacío', () => {
    const gameId = steamGame();
    assert.deepEqual(getGoldbergCatalogItems(fx.ctx, gameId), []);
    seedCatalog(fx.ctx, { gameId });
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(getGoldbergCatalogItems(fx.ctx, gameId), []);
  });
});
