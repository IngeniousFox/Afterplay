import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { achievementCatalogId, externalCheckId } from '../../../../../../shared/sync/ids';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import {
  OTHER,
  T0,
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedGame,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { isGameWriteError } from '../errors';
import { setSteamAppId } from '../setSteamAppId';

// games:setSteamAppId en 2.0. Referencia 1.x: `steamAppId.test.ts` (cambiar
// el catálogo equivocado conservando RetroAchievements; rechazar ids
// inválidos). Más R-09: los desbloqueos de Steam reciben lápida.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const alive = (table: string, id: string): boolean =>
  rawRow(fx.local, table, id)?.syncDeleted === null;

function steamGame(): string {
  const gameId = seedGame(fx.ctx, {
    title: 'Con appid equivocado',
    steamAppId: 100,
    steamAppIdSource: 'auto',
    raGameId: 55,
    metadata: {
      steamPositive: 50,
      steamNegative: 5,
      steamTags: [{ name: 'X', votes: 1 }],
      summary: 'S',
    },
  });
  seedCatalog(fx.ctx, { gameId, source: 'steam', items: [{ apiName: 'OLD_WIN' }] });
  seedCatalog(fx.ctx, { gameId, source: 'ra', items: [{ apiName: '12345' }] });
  seedCheck(fx.ctx, { gameId, source: 'steam_store' });
  seedCheck(fx.ctx, { gameId, source: 'steam_achievements' });
  seedCheck(fx.ctx, { gameId, source: 'steam_unlocks' });
  seedCheck(fx.ctx, { gameId, source: 'ra_achievements' });
  return gameId;
}

describe('setSteamAppId', () => {
  it('un appid distinto se lleva lo de Steam y deja lo de RetroAchievements', () => {
    const gameId = steamGame();
    const steamUnlock = seedUnlock(fx.ctx, { gameId, apiName: 'OLD_WIN' });
    const emuUnlock = seedUnlock(fx.ctx, {
      gameId,
      apiName: 'OLD_WIN',
      // El origen de un emulador de otro PC (`emulatorOrigin`), con su tipo.
      origin: `emu@${OTHER}`,
    });
    const raUnlock = seedUnlock(fx.ctx, { gameId, apiName: '12345', source: 'ra' });
    fx.wall.advance(1_000);

    const updated = setSteamAppId(fx.ctx, gameId, 200);
    assert.equal(updated?.steamAppId, 200);
    assert.equal(updated?.steamAppIdManual, true);
    assert.equal(updated?.steamPositive, null);
    assert.equal(updated?.steamNegative, null);
    assert.equal(updated?.steamTags, null);
    assert.equal(updated?.summary, 'S');
    // `steam_unlocks` se olvida, pero el sello de RA (que en RA vale también
    // por los desbloqueos, como en la 1.x) sigue en pie.
    assert.deepEqual(updated?.achievementsUnlocksSyncedAt, new Date(T0));
    assert.equal(updated?.steamSpyCheckedAt, null);
    assert.deepEqual(updated?.steamAppIdCheckedAt, new Date(T0 + 1_000));
    // El de RA sigue sellado, así que "sincronizado" sigue diciendo algo.
    assert.deepEqual(updated?.achievementsSyncedAt, new Date(T0));

    assert.equal(alive('achievement_catalogs', achievementCatalogId(gameId, 'steam')), false);
    assert.equal(alive('achievement_catalogs', achievementCatalogId(gameId, 'ra')), true);
    // R-09: los desbloqueos de Steam (también los de emulador) con lápida; los de RA no.
    assert.equal(alive('achievement_unlocks', steamUnlock), false);
    assert.equal(alive('achievement_unlocks', emuUnlock), false);
    assert.equal(alive('achievement_unlocks', raUnlock), true);
    for (const source of ['steam_store', 'steam_achievements', 'steam_unlocks']) {
      assert.equal(alive('external_checks', externalCheckId(gameId, source)), false, source);
    }
    assert.equal(alive('external_checks', externalCheckId(gameId, 'ra_achievements')), true);
  });

  it('el mismo appid solo lo marca manual y sellado; no borra nada', () => {
    const gameId = steamGame();
    const unlock = seedUnlock(fx.ctx, { gameId, apiName: 'OLD_WIN' });
    const updated = setSteamAppId(fx.ctx, gameId, 100);
    assert.equal(updated?.steamAppIdManual, true);
    assert.equal(updated?.steamPositive, 50);
    assert.equal(alive('achievement_catalogs', achievementCatalogId(gameId, 'steam')), true);
    assert.equal(alive('achievement_unlocks', unlock), true);
  });

  it('repetirlo no escribe nada nuevo (F-33)', () => {
    const gameId = steamGame();
    setSteamAppId(fx.ctx, gameId, 200);
    for (const table of ['games', 'game_metadata', 'external_checks', 'achievement_catalogs']) {
      markClean(fx.local, table);
    }
    setSteamAppId(fx.ctx, gameId, 200);
    assert.equal(count(fx.local, 'games', 'syncDirty = 1'), 0);
    assert.equal(count(fx.local, 'game_metadata', 'syncDirty = 1'), 0);
    assert.equal(count(fx.local, 'achievement_catalogs', 'syncDirty = 1'), 0);
  });

  it('sin caché ni catálogo no revienta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Pelado' });
    assert.equal(setSteamAppId(fx.ctx, gameId, 300)?.steamAppId, 300);
  });

  it('ids inválidos se rechazan sin tocar el juego; un juego inexistente o borrado da null', () => {
    const gameId = steamGame();
    for (const bad of [0, 0x100000000, 1.5, Number.NaN]) {
      assert.throws(
        () => setSteamAppId(fx.ctx, gameId, bad),
        (error) => isGameWriteError(error, 'invalid_input'),
      );
    }
    assert.equal(rawRow(fx.local, 'games', gameId)?.steamAppId, 100);
    assert.equal(setSteamAppId(fx.ctx, 'no-existe', 5), null);
    fx.ctx.store.remove('games', gameId);
    assert.equal(setSteamAppId(fx.ctx, gameId, 5), null);
    assert.equal(rawRow(fx.local, 'games', gameId)?.steamAppId, 100);
  });
});
