import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  day,
  openQueryDb,
  seedCheck,
  seedGame,
  seedPlaythrough,
  type QueryFixture,
  type SeedGameOptions,
} from '../../common/__tests__/fixtures';
import {
  applyRaMatchResults,
  forgetRaMatchChecks,
  readPlayedPlatforms,
  readRaRefreshTarget,
  selectRaCatalogPending,
  selectRaMatchCandidates,
  selectRaMatchedGames,
  selectRaUnmatchedPlatforms,
} from '../raMatch';
import {
  MANUAL_OVERRIDES,
  checkOf,
  countRows,
  dirtyRows,
  gameRow,
  markClean,
  overridesOf,
} from './helpers';

// El emparejado con RetroAchievements (`ra/backfill.ts`). Los tests 1.x de
// `ra/__tests__/backfill.test.ts` son del emparejado PURO (`matchAgainstLists`,
// `breakTieByPlayedPlatform`), que no toca la base y se queda en `ra/`. Aquí:
// candidatos, el sello con su reintento a los 4 días, la relectura y las
// lecturas de las tres pasadas.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const retro = (title: string, extra: Partial<SeedGameOptions> = {}): string =>
  seedGame(fx.ctx, {
    title,
    metadata: {
      officialPlatforms: ['Sega Mega Drive/Genesis'],
      releaseYear: 1991,
      heroUrl: 'https://img/hero.jpg',
    },
    ...extra,
  });

describe('candidatos (N2)', () => {
  it('sin raGameId y nunca preguntados o vencidos; con sus plataformas y el banner efectivo', () => {
    const nunca = retro('Sonic', { heroOverride: 'https://img/mi-hero.jpg' });
    const reciente = retro('Streets of Rage');
    seedCheck(fx.ctx, { gameId: reciente, source: 'ra_match', status: 'empty' });
    retro('Emparejado', { raGameId: 10 });

    const candidates = selectRaMatchCandidates(fx.ctx);
    assert.deepEqual(candidates, [
      {
        id: nunca,
        title: 'Sonic',
        releaseYear: 1991,
        officialPlatforms: ['Sega Mega Drive/Genesis'],
        heroUrl: 'https://img/mi-hero.jpg',
      },
    ]);

    // A los 4 días el "no" vence y vuelve a ser candidato (REMATCH_AFTER_MS).
    fx.wall.set(day(4).getTime());
    assert.deepEqual(
      selectRaMatchCandidates(fx.ctx).map((c) => c.id),
      [nunca, reciente],
    );
  });

  it('un fallo vence también a los 4 días, no en el siguiente arranque', () => {
    const gameId = retro('Caído');
    seedCheck(fx.ctx, { gameId, source: 'ra_match', status: 'error' });
    assert.deepEqual(selectRaMatchCandidates(fx.ctx), []);
    fx.wall.set(day(4).getTime());
    assert.deepEqual(
      selectRaMatchCandidates(fx.ctx).map((c) => c.id),
      [gameId],
    );
  });
});

describe('applyRaMatchResults', () => {
  it('con set: raGameId + ra_match ok (no vence); sin set: empty a 4 días', () => {
    const sonic = retro('Sonic', { ...MANUAL_OVERRIDES });
    const nada = retro('Sin set');
    const applied = applyRaMatchResults(fx.ctx, [
      { gameId: sonic, raGameId: 1 },
      { gameId: nada, raGameId: null },
    ]);
    assert.deepEqual(applied, { matched: 1, empty: 1, skipped: 0 });
    assert.equal(gameRow(fx, sonic)?.raGameId, 1);
    assert.equal(checkOf(fx, sonic, 'ra_match')?.status, 'ok');
    assert.equal(checkOf(fx, sonic, 'ra_match')?.nextCheckAt, null);
    assert.equal(checkOf(fx, nada, 'ra_match')?.status, 'empty');
    assert.equal(checkOf(fx, nada, 'ra_match')?.nextCheckAt?.getTime(), day(4).getTime());
    assert.deepEqual(overridesOf(fx, sonic), {
      ...MANUAL_OVERRIDES,
      genresOverride: ['Mis géneros'],
    });
  });

  it('re-preguntar un "sin set" mueve el reintento (como raCheckedAt = ahora)', () => {
    const gameId = retro('Sin set');
    applyRaMatchResults(fx.ctx, [{ gameId, raGameId: null }]);
    fx.wall.set(day(4).getTime());
    applyRaMatchResults(fx.ctx, [{ gameId, raGameId: null }]);
    assert.equal(checkOf(fx, gameId, 'ra_match')?.nextCheckAt?.getTime(), day(8).getTime());
  });

  it('relectura: emparejado por otro camino durante la red, o borrado → se salta sin escribir', () => {
    const otro = retro('Otro camino');
    const borrado = retro('Borrado');
    fx.ctx.store.patch('games', otro, { raGameId: 5 });
    fx.ctx.store.remove('games', borrado);
    markClean(fx);
    const applied = applyRaMatchResults(fx.ctx, [
      { gameId: otro, raGameId: 6 },
      { gameId: borrado, raGameId: 7 },
    ]);
    assert.deepEqual(applied, { matched: 0, empty: 0, skipped: 2 });
    assert.equal(gameRow(fx, otro)?.raGameId, 5);
    assert.equal(dirtyRows(fx), 0);
    assert.equal(countRows(fx, 'external_checks'), 0);
  });
});

describe('consolas nuevas (N1)', () => {
  it('lista las plataformas de los no emparejados y olvida sus sellos', () => {
    const a = retro('A');
    const b = retro('B');
    retro('Emparejado', { raGameId: 3 });
    applyRaMatchResults(fx.ctx, [
      { gameId: a, raGameId: null },
      { gameId: b, raGameId: null },
    ]);
    assert.deepEqual(
      selectRaUnmatchedPlatforms(fx.ctx).map((g) => g.id),
      [a, b],
    );
    assert.equal(forgetRaMatchChecks(fx.ctx, [a, 'no-existe']), 1);
    assert.equal(checkOf(fx, a, 'ra_match'), undefined);
    assert.deepEqual(
      selectRaMatchCandidates(fx.ctx).map((c) => c.id),
      [a],
      'vuelve a ser candidato ya',
    );
  });
});

describe('readPlayedPlatforms', () => {
  it('las plataformas de los playthroughs vivos, por juego', () => {
    const gameId = retro('Castlevania');
    seedPlaythrough(fx.ctx, { gameId, playedPlatform: 'PlayStation' });
    const borrado = seedPlaythrough(fx.ctx, { gameId, playedPlatform: 'Sega Saturn' });
    fx.ctx.store.remove('playthroughs', borrado);
    const otro = retro('Otro');
    assert.deepEqual(
      readPlayedPlatforms(fx.ctx, [gameId, otro]),
      new Map([[gameId, ['PlayStation']]]),
    );
    assert.deepEqual(readPlayedPlatforms(fx.ctx, []), new Map());
  });
});

describe('refreshRaForGame y las pasadas de catálogo', () => {
  it('readRaRefreshTarget: "preguntado" = con respuesta; un fallo no cuenta', () => {
    const gameId = retro('Sonic');
    assert.equal(readRaRefreshTarget(fx.ctx, gameId)?.raMatchAsked, false);
    seedCheck(fx.ctx, { gameId, source: 'ra_match', status: 'error' });
    assert.equal(readRaRefreshTarget(fx.ctx, gameId)?.raMatchAsked, false);
    applyRaMatchResults(fx.ctx, [{ gameId, raGameId: null }]);
    assert.equal(readRaRefreshTarget(fx.ctx, gameId)?.raMatchAsked, true);
    assert.equal(readRaRefreshTarget(fx.ctx, 'no-existe'), null);
  });

  it('emparejados vivos, y los que no tienen catálogo de RA (N3) sin depender de Steam', () => {
    const conCatalogo = retro('Con catálogo', { raGameId: 1, steamAppId: 9 });
    seedCheck(fx.ctx, { gameId: conCatalogo, source: 'ra_achievements', status: 'ok' });
    const sinCatalogo = retro('Sin catálogo', { raGameId: 2 });
    // La marca de Steam ya no tapa a RA (MAPA nota 4).
    seedCheck(fx.ctx, { gameId: sinCatalogo, source: 'steam_achievements', status: 'ok' });
    retro('Sin emparejar');
    const borrado = retro('Borrado', { raGameId: 3 });
    fx.ctx.store.remove('games', borrado);

    assert.deepEqual(
      selectRaMatchedGames(fx.ctx).map((g) => [g.title, g.raGameId]),
      [
        ['Con catálogo', 1],
        ['Sin catálogo', 2],
      ],
    );
    assert.deepEqual(
      selectRaCatalogPending(fx.ctx).map((g) => g.id),
      [sinCatalogo],
    );
  });
});
