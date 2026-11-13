import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { radarGames, type RadarGameRow } from '../../../schema';
import {
  day,
  openQueryDb,
  seedGame,
  seedRadarGame,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  dismissRadarGame,
  listRadarGames,
  storeRadarDiscoveries,
  type RadarCandidate,
} from '../radar';

// El radar de secuelas sobre `radar_games` (id `igdb:<igdbId>`). La primera
// parte porta los casos de escritura de `src/main/radar/__tests__/pass.test.ts`
// (lo que guarda `findAnnounced`; la red y el sellado de la semana se quedan en
// `pass.ts`). El resto, lo propio del 2.0: `dismissedAt` sobrevive a la pasada
// y a una lápida.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const fable = (igdbId: number, extra: Partial<RadarCandidate> = {}): RadarCandidate => ({
  igdbId,
  title: `Fable ${igdbId}`,
  coverUrl: null,
  releaseYear: 2027,
  releaseDate: null,
  releaseDatePrecision: null,
  collectionIds: [555],
  ...extra,
});

const raw = (igdbId: number): RadarGameRow | undefined =>
  fx.ctx.db.select().from(radarGames).where(eq(radarGames.igdbId, igdbId)).get();

const listedIds = (): number[] =>
  listRadarGames(fx.ctx)
    .map((game) => game.igdbId)
    .sort((a, b) => a - b);

/** Tu juego de la saga 555, con la colección ya guardada por la fase 1. */
function seedFable(): string {
  return seedGame(fx.ctx, {
    title: 'Fable',
    igdbId: 100,
    metadata: { igdbCollections: [{ id: 555, name: 'Fable Saga' }] },
  });
}

describe('storeRadarDiscoveries (casos de pass.test.ts)', () => {
  it('guarda las secuelas anunciadas con el nombre de TU saga y cuenta las nuevas', () => {
    seedFable();
    const result = storeRadarDiscoveries(fx.ctx, [fable(201), fable(202), fable(203)]);
    assert.deepEqual(result, { discovered: 3, written: 3, removed: 0 });
    assert.deepEqual(listedIds(), [201, 202, 203]);
    const row = listRadarGames(fx.ctx).find((game) => game.igdbId === 201);
    assert.equal(row?.id, 'igdb:201');
    assert.equal(row?.collectionName, 'Fable Saga');
    assert.equal(row?.discoveredAt.getTime(), fx.ctx.now().getTime());
  });

  it('la siguiente pasada solo cuenta lo nuevo: las de antes ya estaban', () => {
    seedFable();
    storeRadarDiscoveries(fx.ctx, [fable(201), fable(202), fable(203)]);
    const result = storeRadarDiscoveries(fx.ctx, [fable(201), fable(202), fable(203), fable(204)]);
    assert.equal(result.discovered, 1);
    assert.deepEqual(listedIds(), [201, 202, 203, 204]);
  });

  it('un juego que ya añadiste a la biblioteca desaparece del radar y no se vuelve a escribir', () => {
    seedFable();
    storeRadarDiscoveries(fx.ctx, [fable(201), fable(202), fable(203), fable(204)]);
    seedGame(fx.ctx, { title: 'Fable 204', igdbId: 204 });
    const result = storeRadarDiscoveries(fx.ctx, [fable(201), fable(202), fable(203), fable(204)]);
    assert.deepEqual(result, { discovered: 0, written: 3, removed: 1 });
    assert.deepEqual(listedIds(), [201, 202, 203]);
    assert.notEqual(raw(204)?.syncDeleted, null);
  });

  it('la limpieza corre aunque la pasada no traiga nada', () => {
    seedRadarGame(fx.ctx, { igdbId: 300, title: 'Ya mío' });
    seedGame(fx.ctx, { title: 'Ya mío', igdbId: 300 });
    assert.deepEqual(storeRadarDiscoveries(fx.ctx, []), { discovered: 0, written: 0, removed: 1 });
    assert.deepEqual(listedIds(), []);
  });
});

describe('storeRadarDiscoveries (2.0)', () => {
  it('reescribir pone al día la fecha y conserva discoveredAt y dismissedAt', () => {
    seedFable();
    storeRadarDiscoveries(fx.ctx, [fable(201)]);
    const discoveredAt = fx.ctx.now();
    fx.wall.advance(1000);
    assert.equal(dismissRadarGame(fx.ctx, 201), true);
    const dismissedAt = fx.ctx.now();
    fx.wall.advance(1000);

    const result = storeRadarDiscoveries(fx.ctx, [
      fable(201, { releaseDate: day(400), releaseDatePrecision: 'day', title: 'Fable IV' }),
    ]);
    assert.equal(result.discovered, 0);
    const row = raw(201);
    assert.equal(row?.title, 'Fable IV');
    assert.equal(row?.releaseDate?.getTime(), day(400).getTime());
    assert.equal(row?.discoveredAt.getTime(), discoveredAt.getTime());
    assert.equal(row?.dismissedAt?.getTime(), dismissedAt.getTime());
    assert.deepEqual(listedIds(), []);
  });

  it('la puerta: crear encima de una fila viva sin indicar dismissedAt lo conserva', () => {
    seedRadarGame(fx.ctx, { igdbId: 220, title: 'Fable 220', dismissedAt: day(-1) });
    const { outcome } = fx.ctx.store.create('radar_games', {
      igdbId: 220,
      title: 'Fable 220 (fecha nueva)',
      discoveredAt: day(0),
    });
    assert.equal(outcome, 'updated');
    assert.equal(raw(220)?.dismissedAt?.getTime(), day(-1).getTime());
  });

  it('un anuncio retirado y descartado que vuelve resucita descartado y no avisa', () => {
    seedRadarGame(fx.ctx, { igdbId: 210, title: 'Fable 210', dismissedAt: day(-5) });
    fx.ctx.store.remove('radar_games', 'igdb:210');
    const result = storeRadarDiscoveries(fx.ctx, [fable(210)]);
    assert.equal(result.discovered, 0);
    assert.equal(raw(210)?.syncDeleted, null);
    assert.equal(raw(210)?.dismissedAt?.getTime(), day(-5).getTime());
    assert.deepEqual(listedIds(), []);
  });

  it('un anuncio retirado sin descartar que vuelve cuenta como nuevo, con discoveredAt nuevo', () => {
    seedRadarGame(fx.ctx, { igdbId: 211, title: 'Fable 211', discoveredAt: day(-30) });
    fx.ctx.store.remove('radar_games', 'igdb:211');
    assert.equal(storeRadarDiscoveries(fx.ctx, [fable(211)]).discovered, 1);
    assert.equal(raw(211)?.discoveredAt.getTime(), fx.ctx.now().getTime());
    assert.deepEqual(listedIds(), [211]);
  });

  it('un juego borrado ya no es tuyo, y sus sagas no dan nombre', () => {
    const borrado = seedFable();
    fx.ctx.store.remove('games', borrado);
    storeRadarDiscoveries(fx.ctx, [fable(100), fable(201)]);
    assert.deepEqual(listedIds(), [100, 201]);
    assert.equal(raw(201)?.collectionName, null);
    assert.equal(raw(201)?.collectionId, null);
  });
});

describe('listRadarGames y dismissRadarGame', () => {
  it('solo vivos sin descartar, por fecha de salida (las sin fecha primero)', () => {
    seedRadarGame(fx.ctx, { igdbId: 1, title: 'Tarde', releaseDate: day(300) });
    seedRadarGame(fx.ctx, { igdbId: 2, title: 'Pronto', releaseDate: day(10) });
    seedRadarGame(fx.ctx, { igdbId: 3, title: 'Sin fecha' });
    seedRadarGame(fx.ctx, { igdbId: 4, title: 'Descartado', dismissedAt: day(1) });
    seedRadarGame(fx.ctx, { igdbId: 5, title: 'Borrado' });
    fx.ctx.store.remove('radar_games', 'igdb:5');
    assert.deepEqual(
      listRadarGames(fx.ctx).map((game) => game.title),
      ['Sin fecha', 'Pronto', 'Tarde'],
    );
  });

  it('descartar: false si no existe o tiene lápida; el segundo descarte no pisa la fecha', () => {
    seedRadarGame(fx.ctx, { igdbId: 7, title: 'Uno' });
    assert.equal(dismissRadarGame(fx.ctx, 8), false);
    assert.equal(dismissRadarGame(fx.ctx, 7), true);
    const first = raw(7)?.dismissedAt?.getTime();
    fx.wall.advance(5000);
    assert.equal(dismissRadarGame(fx.ctx, 7), true);
    assert.equal(raw(7)?.dismissedAt?.getTime(), first);
    fx.ctx.store.remove('radar_games', 'igdb:7');
    assert.equal(dismissRadarGame(fx.ctx, 7), false);
  });
});
