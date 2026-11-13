import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSaveBackup,
  seedSpendEvent,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { canMoveToPlan } from '../../common/canMoveToPlan';
import { getGameById } from '../getGameById';
import { getGames } from '../getGames';
import { getOwnedGames } from '../getOwnedGames';
import { getPlannedGameExtras, getPlannedGames } from '../getPlannedGames';
import { event, session } from './helpers';

// El Plan (los dos canales), la colección del escaneo y `canMoveToPlan`.
// Portado de las LECTURAS de src/main/db/__tests__/moveToPlan.test.ts (la
// escritura `moveToPlan` es de P2) y de los casos de getPlannedGames que había
// repartidos por presupuestos y plan, más lo propio del 2.0: planeado =
// `plan_entries` viva, la nota y la fecha salen de la entrada, valores
// efectivos de la caché.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getPlannedGames · el canal escueto', () => {
  it('solo los juegos con plan_entries viva, en orden alfabético sin mayúsculas', () => {
    seedGame(fx.ctx, { title: 'zelda', planned: true });
    seedGame(fx.ctx, { title: 'Baba Is You', planned: true });
    seedGame(fx.ctx, { title: 'En la biblioteca' });
    const promoted = seedGame(fx.ctx, { title: 'Promocionado', planned: true });
    fx.ctx.store.remove('plan_entries', promoted);
    const deleted = seedGame(fx.ctx, { title: 'Borrado', planned: true });
    fx.ctx.store.remove('games', deleted);

    assert.deepEqual(
      getPlannedGames(fx.ctx).map((g) => g.title),
      ['Baba Is You', 'zelda'],
    );
  });

  it('F-11: una entrada viva de un juego con lápida (sin cascada) no sale', () => {
    const gameId = seedGame(fx.ctx, { title: 'Huérfano', planned: true });
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.deepEqual(getPlannedGames(fx.ctx), []);
    assert.deepEqual(getPlannedGameExtras(fx.ctx), []);
  });

  it('la forma fija de un planeado: cero horas, plan_to_play, sin hero ni ruta', () => {
    seedGame(fx.ctx, {
      title: 'Outer Wilds',
      igdbId: 11737,
      steamAppId: 753640,
      addedAt: new Date('2026-01-01T00:00:00Z'),
      planned: {
        plannedAt: new Date('2026-01-01T00:00:00Z'),
        pinnedAt: new Date('2026-02-01T00:00:00Z'),
      },
      metadata: {
        coverUrl: 'https://img/c.jpg',
        heroUrl: 'https://img/h.jpg',
        genres: ['Adventure'],
        releaseYear: 2019,
        hltbMain: 17,
      },
      install: { executablePath: 'C:\\OW\\ow.exe' },
    });
    const [g] = getPlannedGames(fx.ctx);
    assert.equal(g.igdbId, 11737);
    assert.equal(g.steamAppId, 753640);
    assert.equal(g.coverUrl, 'https://img/c.jpg');
    assert.equal(g.heroUrl, null);
    assert.deepEqual(g.genres, ['Adventure']);
    assert.equal(g.releaseYear, 2019);
    assert.equal(g.hltbMain, 17);
    assert.equal(g.totalHours, 0);
    assert.equal(g.executablePath, null);
    assert.equal(g.currentState, 'plan_to_play');
    assert.deepEqual(g.manualIterations, []);
    assert.equal(g.lastPlayedAt, null);
    assert.equal(g.isLive, false);
    assert.equal(g.sessionCount, 0);
    assert.equal(g.planPinnedAt?.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('el override del usuario manda en la carátula y los géneros', () => {
    seedGame(fx.ctx, {
      title: 'Mía',
      planned: true,
      metadata: { coverUrl: 'https://img/cache.jpg', genres: ['A'] },
      coverOverride: 'https://img/mia.jpg',
      genresOverride: ['B'],
    });
    const [g] = getPlannedGames(fx.ctx);
    assert.equal(g.coverUrl, 'https://img/mia.jpg');
    assert.deepEqual(g.genres, ['B']);
  });

  it('espera desde plan_entries.plannedAt, no desde el alta', () => {
    // planWaitingSince con firstPlanAt = plannedAt (CONSULTAS.md §1.3).
    seedGame(fx.ctx, {
      title: 'Devuelto de Library',
      addedAt: new Date('2024-04-10T12:00:00Z'),
      planned: { plannedAt: new Date('2026-03-05T08:00:01Z') },
    });
    assert.equal(getPlannedGames(fx.ctx)[0].addedAt.toISOString(), '2026-03-05T08:00:01.000Z');
  });

  it('CAMBIO 2.0 (R-06): devolverlo al Plan otra vez espera desde la NUEVA entrada', () => {
    // La 1.x conservaba la primera fecha en el Plan (moveToPlan.test.ts,
    // "no debe estrenar otra fecha de espera"). En 2.0 la entrada resucita
    // con `plannedAt` nuevo y es esa la que cuenta.
    const gameId = seedGame(fx.ctx, {
      title: 'Ida y vuelta',
      planned: { plannedAt: new Date('2025-05-01T09:00:00Z') },
    });
    fx.ctx.store.remove('plan_entries', gameId);
    fx.ctx.store.create('plan_entries', { gameId, plannedAt: new Date('2026-06-01T09:00:00Z') });
    assert.equal(getPlannedGames(fx.ctx)[0].addedAt.toISOString(), '2026-06-01T09:00:00.000Z');
  });

  it('un planeado no sale en la biblioteca, y uno promocionado sí, con su fecha de alta', () => {
    const addedAt = new Date('2025-03-05T08:00:00Z');
    const gameId = seedGame(fx.ctx, { title: 'Ida', addedAt, planned: true });
    assert.equal(
      getGames(fx.ctx).some((g) => g.id === gameId),
      false,
    );
    fx.ctx.store.remove('plan_entries', gameId);
    assert.equal(getGames(fx.ctx)[0].addedAt.toISOString(), addedAt.toISOString());
    assert.deepEqual(getPlannedGames(fx.ctx), []);
  });
});

describe('getPlannedGameExtras · el otro canal', () => {
  it('los mismos ids que el escueto, con el hero real, la caché y la nota del Plan', () => {
    const a = seedGame(fx.ctx, {
      title: 'Outer Wilds',
      planned: { note: 'Me lo recomendó Dani' },
      metadata: {
        heroUrl: 'https://img/h.jpg',
        summary: 'Un bucle de 22 minutos.',
        releaseDate: new Date('2019-05-28T00:00:00Z'),
        releaseDatePrecision: 'day',
        ratingCritics: 85,
        ratingCriticsCount: 30,
        ratingUsers: 88,
        ratingUsersCount: 900,
        steamPositive: 50_000,
        steamNegative: 3_000,
        steamTags: [{ name: 'Space', votes: 100 }],
      },
    });
    const b = seedGame(fx.ctx, {
      title: 'Sin caché',
      planned: true,
      heroOverride: 'https://img/mio.jpg',
    });
    seedGame(fx.ctx, { title: 'En la biblioteca' });

    const extras = getPlannedGameExtras(fx.ctx);
    assert.deepEqual(
      extras.map((e) => e.id).sort(),
      getPlannedGames(fx.ctx)
        .map((g) => g.id)
        .sort(),
    );
    const ea = extras.find((e) => e.id === a)!;
    assert.equal(ea.heroUrl, 'https://img/h.jpg');
    assert.equal(ea.summary, 'Un bucle de 22 minutos.');
    assert.equal(ea.planNote, 'Me lo recomendó Dani');
    assert.equal(ea.releaseDate?.toISOString(), '2019-05-28T00:00:00.000Z');
    assert.equal(ea.releaseDatePrecision, 'day');
    assert.deepEqual(
      [ea.ratingCritics, ea.ratingCriticsCount, ea.ratingUsers, ea.ratingUsersCount],
      [85, 30, 88, 900],
    );
    assert.deepEqual([ea.steamPositive, ea.steamNegative], [50_000, 3_000]);
    assert.deepEqual(ea.steamTags, [{ name: 'Space', votes: 100 }]);

    const eb = extras.find((e) => e.id === b)!;
    assert.equal(eb.heroUrl, 'https://img/mio.jpg');
    assert.equal(eb.planNote, null);
    assert.equal(eb.summary, null);
  });

  it('la nota de una entrada con lápida no se cuela (el juego ya no está en el Plan)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Promocionado', planned: { note: 'vieja' } });
    fx.ctx.store.remove('plan_entries', gameId);
    assert.deepEqual(getPlannedGameExtras(fx.ctx), []);
  });
});

describe('getOwnedGames · la colección del escaneo', () => {
  it('biblioteca Y plan, con planned = plan_entries viva; sin los borrados', () => {
    const lib = seedGame(fx.ctx, { title: 'Biblioteca', igdbId: 1 });
    const plan = seedGame(fx.ctx, { title: 'Plan', planned: true });
    const promoted = seedGame(fx.ctx, { title: 'Promocionado', planned: true });
    fx.ctx.store.remove('plan_entries', promoted);
    const deleted = seedGame(fx.ctx, { title: 'Borrado', planned: true });
    fx.ctx.store.remove('games', deleted);

    const owned = getOwnedGames(fx.ctx).sort((a, b) => a.title.localeCompare(b.title));
    assert.deepEqual(owned, [
      { id: lib, igdbId: 1, title: 'Biblioteca', planned: false },
      { id: plan, igdbId: null, title: 'Plan', planned: true },
      { id: promoted, igdbId: null, title: 'Promocionado', planned: false },
    ]);
  });
});

describe('canMoveToPlan · el gesto de volver al Plan (lecturas de moveToPlan.test.ts)', () => {
  it('un juego con un playthrough vacío y solo una compra sí puede volver', () => {
    const gameId = seedGame(fx.ctx, { title: 'Comprado sin jugar' });
    seedPlaythrough(fx.ctx, { gameId });
    seedSpendEvent(fx.ctx, { gameId, type: 'purchase', amount: 19.99 });
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
    assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, true);
  });

  it('2.0: un juego sin ningún playthrough también puede volver', () => {
    const gameId = seedGame(fx.ctx, { title: 'Sin playthrough' });
    assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, true);
  });

  it('un juego que ya está en el Plan no ofrece el gesto', () => {
    const gameId = seedGame(fx.ctx, { title: 'Planeado', planned: true });
    assert.equal(canMoveToPlan(fx.ctx, gameId), false);
    assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, false);
  });

  it('un juego que no existe o tiene lápida no se puede mover', () => {
    assert.equal(canMoveToPlan(fx.ctx, 'no-existe'), false);
    const gameId = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', gameId);
    assert.equal(canMoveToPlan(fx.ctx, gameId), false);
  });

  it('deja de ofrecerse en cuanto gana una sesión', () => {
    const gameId = seedGame(fx.ctx, { title: 'Recién jugado' });
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, true);
    session(fx.ctx, ptId, '2026-03-01T10:00:00Z', 0.5);
    assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, false);
  });

  const blockers: [string, (gameId: string, ptId: string) => void][] = [
    ['un estado real', (_g, p) => void event(fx.ctx, p, 'started', '2026-01-05T00:00:00Z')],
    [
      "el papeleo del alta ('unknown')",
      (_g, p) =>
        void event(fx.ctx, p, 'completed', '2026-01-05T00:00:00Z', { datePrecision: 'unknown' }),
    ],
    ['horas manuales', (_g, p) => void fx.ctx.store.patch('playthroughs', p, { manualHours: 2 })],
    ['otro playthrough', (g) => void seedPlaythrough(fx.ctx, { gameId: g })],
    [
      'gasto dentro del juego',
      (g) => void seedSpendEvent(fx.ctx, { gameId: g, type: 'ingame_spend', amount: 4.99 }),
    ],
    ['un logro desbloqueado', (g) => void seedUnlock(fx.ctx, { gameId: g, apiName: 'ACH_TEST' })],
    ['una copia de partida', (g) => void seedSaveBackup(fx.ctx, { gameId: g })],
    [
      'una valoración del playthrough',
      (_g, p) => void fx.ctx.store.patch('playthroughs', p, { rating: 4 }),
    ],
    [
      'contenido extra',
      (_g, p) => void fx.ctx.store.patch('playthroughs', p, { extraContent: true }),
    ],
  ];

  for (const [label, addRecord] of blockers) {
    it(`no ofrece el retorno si hay ${label}`, () => {
      const gameId = seedGame(fx.ctx, { title: 'Jugado' });
      const ptId = seedPlaythrough(fx.ctx, { gameId });
      addRecord(gameId, ptId);
      assert.equal(getGameById(fx.ctx, gameId)?.canMoveToPlan, false);
    });
  }

  it('lo borrado no bloquea: sesión, evento, gasto, logro y copia con lápida', () => {
    const gameId = seedGame(fx.ctx, { title: 'Limpio otra vez' });
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    const s = session(fx.ctx, ptId, '2026-03-01T10:00:00Z', 1);
    const e = event(fx.ctx, ptId, 'started', '2026-03-01T10:00:00Z');
    const sp = seedSpendEvent(fx.ctx, { gameId, type: 'ingame_spend', amount: 5 });
    const u = seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1' });
    const b = seedSaveBackup(fx.ctx, { gameId });
    fx.ctx.store.remove('sessions', s);
    fx.ctx.store.remove('state_events', e);
    fx.ctx.store.remove('spend_events', sp);
    fx.ctx.store.remove('achievement_unlocks', u);
    fx.ctx.store.remove('save_backups', b);
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
  });

  it('F-11: la sesión viva de un playthrough con lápida no bloquea', () => {
    const gameId = seedGame(fx.ctx, { title: 'Con huérfana' });
    const dead = seedPlaythrough(fx.ctx, { gameId });
    session(fx.ctx, dead, '2026-03-01T10:00:00Z', 1);
    tombstoneOnly(fx.ctx, 'playthroughs', dead);
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
  });
});
