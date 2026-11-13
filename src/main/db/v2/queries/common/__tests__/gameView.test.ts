import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isNull } from 'drizzle-orm';
import { gameViewRows, readGameRow, readGameRows, viewPlan } from '../gameView';
import { writeCheck } from '../checks';
import {
  T0,
  asOtherDevice,
  at,
  day,
  openQueryDb,
  seedCuriosities,
  seedGame,
  type QueryFixture,
} from './fixtures';

// La vista común del juego y su mapeo a `GameRow` (CONSULTAS.md §1.2). Es
// también la plantilla de test de una lectura: base en memoria, filas por los
// seeds, ids guardados de lo que devuelven, y la otra máquina para lo que
// depende del dispositivo.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('readGameRow', () => {
  it('un juego mínimo: caché, plan, rutas y sellos a null', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    const row = readGameRow(fx.ctx, id);
    assert.ok(row);
    assert.equal(row.id, id);
    assert.equal(row.title, 'Celeste');
    assert.equal(row.addedAt.getTime(), T0);
    assert.equal(row.planned, false);
    assert.equal(row.coverUrl, null);
    assert.equal(row.executablePath, null);
    assert.equal(row.steamAppIdManual, false);
    assert.equal(row.achievementsSyncedAt, null);
    assert.equal(row.endless, false);
    assert.equal(row.saveBackupEnabled, false);
  });

  it('null si no existe o tiene lápida', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', id);
    assert.equal(readGameRow(fx.ctx, id), null);
    assert.equal(readGameRow(fx.ctx, 'no-existe'), null);
  });

  it('valores efectivos: el override del usuario manda sobre la caché (D-22)', () => {
    const metadata = {
      coverUrl: 'https://img/igdb-cover.jpg',
      heroUrl: 'https://img/igdb-hero.jpg',
      developer: 'Maddy Makes Games',
      publisher: 'Matt Makes Games',
      genres: ['Platform'],
    };
    const auto = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226, metadata });
    const manual = seedGame(fx.ctx, {
      title: 'Celeste (mía)',
      metadata,
      coverOverride: 'https://img/mia.jpg',
      heroOverride: 'https://img/mia-hero.jpg',
      developerOverride: 'EXOK',
      publisherOverride: 'EXOK',
      genresOverride: ['Indie'],
    });

    const a = readGameRow(fx.ctx, auto)!;
    assert.equal(a.coverUrl, metadata.coverUrl);
    assert.equal(a.heroUrl, metadata.heroUrl);
    assert.equal(a.developer, metadata.developer);
    assert.equal(a.publisher, metadata.publisher);
    assert.deepEqual(a.genres, ['Platform']);
    assert.equal(a.igdbId, 26226);

    const m = readGameRow(fx.ctx, manual)!;
    assert.equal(m.coverUrl, 'https://img/mia.jpg');
    assert.equal(m.heroUrl, 'https://img/mia-hero.jpg');
    assert.equal(m.developer, 'EXOK');
    assert.equal(m.publisher, 'EXOK');
    assert.deepEqual(m.genres, ['Indie']);
  });

  it('la caché entera llega tal cual (sin override)', () => {
    const id = seedGame(fx.ctx, {
      title: 'Hades',
      metadata: {
        officialPlatforms: ['PC', 'Switch'],
        releaseYear: 2020,
        releaseDate: day(-2000),
        releaseDatePrecision: 'day',
        summary: 'Escapa del inframundo.',
        igdbCollections: [{ id: 1, name: 'Hades' }],
        hltbMain: 22,
        hltbMainExtras: 48.5,
        hltbCompletionist: 95,
        ratingCritics: 93,
        ratingCriticsCount: 40,
        ratingUsers: 90,
        ratingUsersCount: 2000,
        steamTags: [{ name: 'Roguelike', votes: 900 }],
        steamPositive: 200_000,
        steamNegative: 3_000,
      },
    });
    const row = readGameRow(fx.ctx, id)!;
    assert.deepEqual(row.officialPlatforms, ['PC', 'Switch']);
    assert.equal(row.releaseYear, 2020);
    assert.equal(row.releaseDate?.getTime(), day(-2000).getTime());
    assert.equal(row.releaseDatePrecision, 'day');
    assert.equal(row.summary, 'Escapa del inframundo.');
    assert.deepEqual(row.igdbCollections, [{ id: 1, name: 'Hades' }]);
    assert.equal(row.hltbMainExtras, 48.5);
    assert.equal(row.ratingUsersCount, 2000);
    assert.deepEqual(row.steamTags, [{ name: 'Roguelike', votes: 900 }]);
    assert.equal(row.steamNegative, 3_000);
  });

  it('planned y planPinnedAt salen de plan_entries viva', () => {
    const id = seedGame(fx.ctx, { title: 'Hollow Knight', planned: { pinnedAt: at(5) } });
    let row = readGameRow(fx.ctx, id)!;
    assert.equal(row.planned, true);
    assert.equal(row.planPinnedAt?.getTime(), T0 + 5);

    fx.ctx.store.remove('plan_entries', id); // promocionado
    row = readGameRow(fx.ctx, id)!;
    assert.equal(row.planned, false);
    assert.equal(row.planPinnedAt, null);
  });

  it('las rutas son las de ESTE PC: las de otra máquina no salen', () => {
    const here = seedGame(fx.ctx, {
      title: 'Aquí',
      install: { executablePath: 'C:\\A\\a.exe', installDirectory: 'C:\\A', installSizeBytes: 10 },
    });
    const there = seedGame(fx.ctx, { title: 'Allí' });
    asOtherDevice(fx.ctx).seedInstall({ gameId: there, installDirectory: 'D:\\B' });
    asOtherDevice(fx.ctx).seedInstall({ gameId: here, executablePath: 'D:\\otra.exe' });

    const a = readGameRow(fx.ctx, here)!;
    assert.equal(a.executablePath, 'C:\\A\\a.exe');
    assert.equal(a.installDirectory, 'C:\\A');
    assert.equal(a.installSizeBytes, 10);
    const b = readGameRow(fx.ctx, there)!;
    assert.equal(b.executablePath, null);
    assert.equal(b.installDirectory, null);
  });

  it('steamAppIdManual sale de steamAppIdSource', () => {
    const id = seedGame(fx.ctx, {
      title: 'Hades',
      steamAppId: 1145360,
      steamAppIdSource: 'manual',
    });
    const row = readGameRow(fx.ctx, id)!;
    assert.equal(row.steamAppId, 1145360);
    assert.equal(row.steamAppIdManual, true);
    assert.equal(row.steamGridDbId, null);
  });

  it('los sellos salen de external_checks; un fallo no es sello (como en la 1.x)', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    writeCheck(fx.ctx, id, 'steam_appid', 'empty', { checkedAt: at(1) });
    writeCheck(fx.ctx, id, 'steam_achievements', 'ok', { checkedAt: at(2) });
    writeCheck(fx.ctx, id, 'ra_achievements', 'ok', { checkedAt: at(3) });
    writeCheck(fx.ctx, id, 'steam_unlocks', 'ok', { checkedAt: at(4) });
    writeCheck(fx.ctx, id, 'ra_match', 'empty', { checkedAt: at(5) });
    writeCheck(fx.ctx, id, 'igdb_ratings', 'ok', { checkedAt: at(6) });
    writeCheck(fx.ctx, id, 'steam_store', 'error', { checkedAt: at(7) });
    seedCuriosities(fx.ctx, { gameId: id, generatedAt: at(8) });

    const row = readGameRow(fx.ctx, id)!;
    assert.equal(row.steamAppIdCheckedAt?.getTime(), T0 + 1);
    // La más reciente de las dos fuentes de logros.
    assert.equal(row.achievementsSyncedAt?.getTime(), T0 + 3);
    assert.equal(row.achievementsUnlocksSyncedAt?.getTime(), T0 + 4);
    assert.equal(row.raCheckedAt?.getTime(), T0 + 5);
    assert.equal(row.ratingsCheckedAt?.getTime(), T0 + 6);
    assert.equal(row.steamSpyCheckedAt, null);
    assert.equal(row.curiositiesGeneratedAt?.getTime(), T0 + 8);
  });

  it('una caché o un plan con lápida es como no tenerlos', () => {
    const id = seedGame(fx.ctx, {
      title: 'Celeste',
      metadata: { coverUrl: 'https://img/c.jpg' },
      planned: true,
    });
    fx.ctx.store.remove('game_metadata', id);
    fx.ctx.store.remove('plan_entries', id);
    const row = readGameRow(fx.ctx, id)!;
    assert.equal(row.coverUrl, null);
    assert.equal(row.planned, false);
  });
});

describe('readGameRows y gameViewRows', () => {
  it('varios juegos en una consulta, en orden de creación, sin los borrados', () => {
    const a = seedGame(fx.ctx, { title: 'A' });
    const b = seedGame(fx.ctx, { title: 'B', planned: true });
    const c = seedGame(fx.ctx, { title: 'C' });
    fx.ctx.store.remove('games', c);

    assert.deepEqual(
      readGameRows(fx.ctx).map((row) => row.title),
      ['A', 'B'],
    );
    assert.deepEqual(
      readGameRows(fx.ctx, [b, c, a, a]).map((row) => row.id),
      [a, b],
    );
    assert.deepEqual(readGameRows(fx.ctx, []), []);
  });

  it('el where puede usar los alias de la vista: no planeados', () => {
    seedGame(fx.ctx, { title: 'Biblioteca' });
    seedGame(fx.ctx, { title: 'Plan', planned: true });
    assert.deepEqual(
      gameViewRows(fx.ctx, isNull(viewPlan.id)).map((row) => row.title),
      ['Biblioteca'],
    );
  });
});
