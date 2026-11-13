import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  LOCAL,
  OTHER,
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedGame,
  seedInstall,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameCompletion } from '../completion';
import { achievementKey, parseAchievementKey } from '../ids';
import {
  getAchievementsRefreshTarget,
  getAchievementsStatus,
  getEmuUnlockTargets,
  getPendingAchievementsGames,
  getRaMatchedGames,
  getSteamLivePollGames,
  type AchievementsStatusOptions,
} from '../status';
import { storeUnlocks } from '../storeUnlocks';

// Port de src/main/db/__tests__/achievementsStatus.test.ts (tarjeta de Ajustes
// y "a quién le toca"), de la regla de raLivePoll.test.ts (TODAS las fichas de
// un set) y de la cuenta de celebrateCompletion.test.ts, ahora por fuente.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const OPTIONS: AchievementsStatusOptions = {
  running: false,
  failedGames: 0,
  hasApiKey: true,
  hasUserId: true,
  hasRaCredentials: false,
};
const status = (
  options: Partial<AchievementsStatusOptions> = {},
): ReturnType<typeof getAchievementsStatus> =>
  getAchievementsStatus(fx.ctx, { ...OPTIONS, ...options });

describe('getAchievementsStatus: el denominador de "juegos elegibles"', () => {
  it('combina los contadores sin perder catálogos ni duplicar desbloqueos por origen', () => {
    const gameId = seedGame(fx.ctx, { title: 'Las dos', steamAppId: 620, raGameId: 1 });
    // Un sello sin fuente sigue siendo una sincronización.
    const sinFuente = seedGame(fx.ctx, { title: 'Sello suelto' });
    seedCheck(fx.ctx, { gameId: sinFuente, source: 'steam_achievements', checkedAt: new Date(0) });
    seedCatalog(fx.ctx, { gameId, items: [{ apiName: 'FIRST' }, { apiName: 'SECOND' }] });
    seedUnlock(fx.ctx, { gameId, apiName: 'FIRST', origin: 'steam' });
    seedUnlock(fx.ctx, { gameId, apiName: 'FIRST', origin: `emu@${LOCAL}` });
    const result = status({ running: true, failedGames: 2 });
    assert.equal(result.eligibleGames, 1);
    assert.equal(result.syncedGames, 2);
    assert.equal(result.totalAchievements, 2);
    assert.equal(result.unlockedAchievements, 1);
  });

  it('cuenta steamAppId O raGameId, y un juego con LAS DOS no cuenta doble', () => {
    seedGame(fx.ctx, { title: 'Solo Steam', steamAppId: 620 });
    seedGame(fx.ctx, { title: 'Solo RA', raGameId: 4650 });
    seedGame(fx.ctx, { title: 'Las dos', steamAppId: 730, raGameId: 1 });
    seedGame(fx.ctx, { title: 'Ninguna' });
    assert.equal(status().eligibleGames, 3);
  });

  it('un juego PLANEADO con appid SÍ cuenta; uno borrado no', () => {
    seedGame(fx.ctx, { title: 'Planeado con appid', planned: true, steamAppId: 620 });
    seedGame(fx.ctx, { title: 'Planeado sin appid', planned: true });
    const borrado = seedGame(fx.ctx, { title: 'Borrado', steamAppId: 730 });
    fx.ctx.store.remove('games', borrado);
    assert.equal(status().eligibleGames, 1);
  });

  it('una biblioteca vacía da ceros, no undefined ni NaN', () => {
    const result = status();
    assert.equal(result.eligibleGames, 0);
    assert.equal(result.syncedGames, 0);
    assert.equal(result.totalAchievements, 0);
    assert.equal(result.unlockedAchievements, 0);
    assert.deepEqual(result.bySource.steam, {
      syncedGames: 0,
      totalAchievements: 0,
      unlockedAchievements: 0,
      perfectGames: 0,
    });
  });

  it('syncedGames cuenta el catálogo respondido, aunque viniera vacío; un fallo no', () => {
    const preguntado = seedGame(fx.ctx, { title: 'Preguntado sin catálogo', steamAppId: 620 });
    seedCheck(fx.ctx, { gameId: preguntado, source: 'steam_achievements', status: 'empty' });
    const fallido = seedGame(fx.ctx, { title: 'Fallido', steamAppId: 621 });
    seedCheck(fx.ctx, { gameId: fallido, source: 'steam_achievements', status: 'error' });
    seedGame(fx.ctx, { title: 'Nunca preguntado', steamAppId: 730 });
    assert.equal(status().syncedGames, 1);
  });

  it('running, failedGames y las credenciales viajan tal cual', () => {
    const result = status({
      running: true,
      failedGames: 7,
      hasApiKey: false,
      hasRaCredentials: true,
    });
    assert.equal(result.running, true);
    assert.equal(result.failedGames, 7);
    assert.equal(result.hasApiKey, false);
    assert.equal(result.hasRaCredentials, true);
  });

  it('por fuente: catálogos, desbloqueos y juegos al 100% de cada una (R-11)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Clásico', steamAppId: 10, raGameId: 20 });
    seedCheck(fx.ctx, { gameId, source: 'ra_achievements' });
    seedCatalog(fx.ctx, { gameId, items: [{ apiName: 'A' }, { apiName: 'B' }] });
    seedCatalog(fx.ctx, { gameId, source: 'ra', items: [{ apiName: '1' }] });
    seedUnlock(fx.ctx, { gameId, apiName: 'A' });
    seedUnlock(fx.ctx, { gameId, source: 'ra', apiName: '1' });
    const result = status();
    assert.deepEqual(result.bySource.steam, {
      syncedGames: 1,
      totalAchievements: 2,
      unlockedAchievements: 1,
      perfectGames: 0,
    });
    assert.deepEqual(result.bySource.ra, {
      syncedGames: 1,
      totalAchievements: 1,
      unlockedAchievements: 1,
      perfectGames: 1,
    });
    assert.equal(result.syncedGames, 1);
    assert.equal(result.totalAchievements, 3);
  });

  it('un desbloqueo cuyo logro no está en el catálogo no cuenta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Huérfano', steamAppId: 10 });
    seedCatalog(fx.ctx, { gameId, items: [{ apiName: 'A' }] });
    seedUnlock(fx.ctx, { gameId, apiName: 'RETIRADO_DE_VERDAD' });
    assert.equal(status().unlockedAchievements, 0);
  });
});

describe('getPendingAchievementsGames: a quién le toca sincronizar', () => {
  it('sin steamAppId no hay nada que preguntar, planeado o no; raGameId no basta', () => {
    seedGame(fx.ctx, { title: 'Sin appid' });
    seedGame(fx.ctx, { title: 'Sin appid, planeado', planned: true });
    seedGame(fx.ctx, { title: 'Solo RA', raGameId: 4650 });
    assert.deepEqual(getPendingAchievementsGames(fx.ctx, false), []);
    assert.deepEqual(getPendingAchievementsGames(fx.ctx, true), []);
  });

  it('un juego PLANEADO con steamAppId entra', () => {
    seedGame(fx.ctx, { title: 'Planeado', planned: true, steamAppId: 620 });
    const [pending] = getPendingAchievementsGames(fx.ctx, false);
    assert.equal(pending.title, 'Planeado');
    assert.equal(pending.steamAppId, 620);
  });

  it('full=false solo trae los que no tienen el catálogo de Steam respondido; un fallo se reintenta', () => {
    const hecho = seedGame(fx.ctx, { title: 'Ya sincronizado', steamAppId: 620 });
    seedCheck(fx.ctx, { gameId: hecho, source: 'steam_achievements' });
    const fallido = seedGame(fx.ctx, { title: 'Fallido', steamAppId: 621 });
    seedCheck(fx.ctx, { gameId: fallido, source: 'steam_achievements', status: 'error' });
    seedGame(fx.ctx, { title: 'Pendiente', steamAppId: 730 });
    assert.deepEqual(
      getPendingAchievementsGames(fx.ctx, false).map((game) => game.title),
      ['Fallido', 'Pendiente'],
    );
  });

  it('el sello de RA ya no tapa el catálogo de Steam (antes compartían achievementsSyncedAt)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Clásico con puerto', steamAppId: 620, raGameId: 5 });
    seedCheck(fx.ctx, { gameId, source: 'ra_achievements' });
    assert.deepEqual(
      getPendingAchievementsGames(fx.ctx, false).map((game) => game.title),
      ['Clásico con puerto'],
    );
  });

  it('full=true trae TODOS los que tienen steamAppId', () => {
    const hecho = seedGame(fx.ctx, { title: 'Ya sincronizado', steamAppId: 620 });
    seedCheck(fx.ctx, { gameId: hecho, source: 'steam_achievements' });
    seedGame(fx.ctx, { title: 'Pendiente', steamAppId: 730 });
    assert.deepEqual(
      getPendingAchievementsGames(fx.ctx, true)
        .map((game) => game.title)
        .sort(),
      ['Pendiente', 'Ya sincronizado'],
    );
  });

  it('el orden es por título, sin importar mayúsculas ni minúsculas', () => {
    seedGame(fx.ctx, { title: 'zelda', steamAppId: 1 });
    seedGame(fx.ctx, { title: 'Alba', steamAppId: 2 });
    seedGame(fx.ctx, { title: 'braid', steamAppId: 3 });
    assert.deepEqual(
      getPendingAchievementsGames(fx.ctx, true).map((game) => game.title),
      ['Alba', 'braid', 'zelda'],
    );
  });

  it('cada fila trae ejecutable y carpeta de ESTE PC y el hero efectivo', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Con datos de emulador',
      steamAppId: 620,
      heroOverride: 'https://hero/g.jpg',
      install: { executablePath: 'C:\\Games\\g\\g.exe', installDirectory: 'C:\\Games\\g' },
    });
    const [pending] = getPendingAchievementsGames(fx.ctx, false);
    assert.deepEqual(pending, {
      id: gameId,
      title: 'Con datos de emulador',
      steamAppId: 620,
      executablePath: 'C:\\Games\\g\\g.exe',
      installDirectory: 'C:\\Games\\g',
      heroUrl: 'https://hero/g.jpg',
    });
  });

  it('el refresco tras una sesión encuentra el juego con appid, o null', () => {
    const conAppid = seedGame(fx.ctx, { title: 'Con appid', steamAppId: 620 });
    const sinAppid = seedGame(fx.ctx, { title: 'Sin appid' });
    assert.equal(getAchievementsRefreshTarget(fx.ctx, conAppid)?.steamAppId, 620);
    assert.equal(getAchievementsRefreshTarget(fx.ctx, sinAppid), null);
    assert.equal(getAchievementsRefreshTarget(fx.ctx, 'no-existe'), null);
  });
});

describe('objetivos de los caminos en vivo', () => {
  it('emuladores: TODAS las fichas con ese appid y catálogo de Steam, con la ruta de este PC', () => {
    const juego = seedGame(fx.ctx, { title: 'Juego', steamAppId: 620 });
    const edicion = seedGame(fx.ctx, { title: 'Edición', steamAppId: 620 });
    const sinCatalogo = seedGame(fx.ctx, { title: 'Sin catálogo', steamAppId: 620 });
    const soloRa = seedGame(fx.ctx, { title: 'Solo RA', steamAppId: 621, raGameId: 9 });
    seedCatalog(fx.ctx, { gameId: juego });
    seedCatalog(fx.ctx, { gameId: edicion });
    seedCatalog(fx.ctx, { gameId: soloRa, source: 'ra' });
    seedInstall(fx.ctx, { gameId: juego, executablePath: 'C:\\J\\j.exe' });
    void sinCatalogo;
    const targets = getEmuUnlockTargets(fx.ctx, [620, 621]);
    assert.deepEqual(targets.map((t) => t.title).sort(), ['Edición', 'Juego']);
    assert.equal(targets.find((t) => t.id === juego)?.executablePath, 'C:\\J\\j.exe');
    assert.deepEqual(getEmuUnlockTargets(fx.ctx).length, 2);
    assert.deepEqual(getEmuUnlockTargets(fx.ctx, []), []);
  });

  it('sondeo de Steam: solo los que corren y tienen appid', () => {
    const con = seedGame(fx.ctx, { title: 'Con appid', steamAppId: 620 });
    const sin = seedGame(fx.ctx, { title: 'Emulado', isEmulated: true });
    assert.deepEqual(
      getSteamLivePollGames(fx.ctx, [con, sin]).map((g) => g.id),
      [con],
    );
    assert.deepEqual(getSteamLivePollGames(fx.ctx, []), []);
  });

  it('sondeo de RA: dos fichas emparejadas con el mismo set reciben las dos el logro', () => {
    const elJuego = seedGame(fx.ctx, { title: 'Super Mario World', raGameId: 12345 });
    const laColeccion = seedGame(fx.ctx, {
      title: 'Super Mario All-Stars + World',
      raGameId: 12345,
    });
    seedGame(fx.ctx, { title: 'Otro set', raGameId: 1 });
    for (const gameId of [elJuego, laColeccion]) {
      seedCatalog(fx.ctx, {
        gameId,
        source: 'ra',
        items: [{ apiName: '777', displayName: 'Warp Zone' }],
      });
    }
    const matched = getRaMatchedGames(fx.ctx, [12345]);
    assert.deepEqual(matched.map((g) => g.id).sort(), [elJuego, laColeccion].sort());
    for (const game of matched) {
      storeUnlocks(fx.ctx, {
        gameId: game.id,
        feed: 'ra',
        unlocks: [{ apiName: '777', unlockedAt: new Date('2026-02-01T19:30:00Z') }],
        fallbackDate: new Date('2026-02-01T20:00:00Z'),
        expectedRaGameId: game.raGameId,
      });
    }
    for (const gameId of [elJuego, laColeccion]) {
      assert.equal(getGameCompletion(fx.ctx, gameId)[0].unlocked, 1);
    }
  });

  it('pendientes de RA: los emparejados sin ra_achievements respondido; el sello de Steam no cuenta', () => {
    const hecho = seedGame(fx.ctx, { title: 'Hecho', raGameId: 1 });
    seedCheck(fx.ctx, { gameId: hecho, source: 'ra_achievements' });
    const conSteam = seedGame(fx.ctx, { title: 'Con Steam', raGameId: 2, steamAppId: 10 });
    seedCheck(fx.ctx, { gameId: conSteam, source: 'steam_achievements' });
    const fallido = seedGame(fx.ctx, { title: 'Fallido', raGameId: 3 });
    seedCheck(fx.ctx, { gameId: fallido, source: 'ra_achievements', status: 'error' });
    assert.deepEqual(
      getRaMatchedGames(fx.ctx, undefined, { pendingOnly: true })
        .map((g) => g.title)
        .sort(),
      ['Con Steam', 'Fallido'],
    );
  });

  it('un set de RA que no está en la biblioteca no encuentra fichas', () => {
    seedGame(fx.ctx, { title: 'Super Mario World', raGameId: 12345 });
    assert.deepEqual(getRaMatchedGames(fx.ctx, [99999]), []);
    assert.equal(getRaMatchedGames(fx.ctx).length, 1);
  });
});

describe('getGameCompletion: el 100% por fuente (celebrateCompletion, R-11)', () => {
  const gameWith = (
    total: number,
    unlocked: number,
    source: 'steam' | 'ra' = 'steam',
    gameId?: string,
  ): string => {
    const id = gameId ?? seedGame(fx.ctx, { title: 'Celeste' });
    const keys = Array.from({ length: total }, (_, index) => `A${index}`);
    seedCatalog(fx.ctx, { gameId: id, source, items: keys.map((apiName) => ({ apiName })) });
    for (const apiName of keys.slice(0, unlocked))
      seedUnlock(fx.ctx, { gameId: id, source, apiName });
    return id;
  };

  it('un juego al que le falta un logro no está completo; al cerrarlo, sí', () => {
    const gameId = gameWith(2, 1);
    assert.deepEqual(
      getGameCompletion(fx.ctx, gameId).map((c) => [c.source, c.unlocked, c.total, c.complete]),
      [['steam', 1, 2, false]],
    );
    seedUnlock(fx.ctx, { gameId, apiName: 'A1' });
    assert.equal(getGameCompletion(fx.ctx, gameId)[0].complete, true);
  });

  it('un logro sacado por dos orígenes cuenta una vez (el countDistinct de complete.ts)', () => {
    const gameId = gameWith(2, 1);
    seedUnlock(fx.ctx, { gameId, apiName: 'A0', origin: `emu@${OTHER}` });
    const [steam] = getGameCompletion(fx.ctx, gameId);
    assert.equal(steam.unlocked, 1);
    assert.equal(steam.complete, false);
  });

  it('Steam y RA son dos hitos: completar RA no depende de Steam', () => {
    const gameId = gameWith(3, 1, 'steam');
    gameWith(2, 2, 'ra', gameId);
    assert.deepEqual(
      getGameCompletion(fx.ctx, gameId).map((c) => [c.source, c.complete, c.total]),
      [
        ['steam', false, 3],
        ['ra', true, 2],
      ],
    );
  });

  it('un catálogo vacío nunca está completo; un juego borrado no tiene completado', () => {
    const gameId = seedGame(fx.ctx, { title: 'Vacío' });
    seedCatalog(fx.ctx, { gameId, items: [] });
    assert.deepEqual(
      getGameCompletion(fx.ctx, gameId).map((c) => c.complete),
      [false],
    );
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(getGameCompletion(fx.ctx, gameId), []);
  });
});

describe('ids de logro', () => {
  it('la clave se forma y se lee, aunque el apiName lleve ":"', () => {
    const key = achievementKey('019a-game', 'steam', 'NEW:ACHIEVEMENT:1');
    assert.equal(key, '019a-game:steam:NEW:ACHIEVEMENT:1');
    assert.deepEqual(parseAchievementKey(key), {
      gameId: '019a-game',
      source: 'steam',
      apiName: 'NEW:ACHIEVEMENT:1',
    });
    assert.equal(parseAchievementKey('sin-forma'), null);
    assert.equal(parseAchievementKey('g:otro:api'), null);
    assert.throws(() => achievementKey('a:b', 'ra', 'x'), RangeError);
  });
});
