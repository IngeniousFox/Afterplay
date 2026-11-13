import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { externalCheckId, gameIdForIgdb, gameInstallId } from '../../../../../../shared/sync/ids';
import { count, rawRow } from '../../../__tests__/helpers';
import {
  T0,
  at,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSpendEvent,
  seedStateEvent,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { createGameWithDetails } from '../createGameWithDetails';
import { deleteGame } from '../deleteGame';
import { isGameWriteError } from '../errors';
import { findLiveGameIdForIgdb, planEnrichmentRequest } from '../newGame';
import { EUR, createInput, enrichment, steamEnrichment } from './helpers';

// games:createWithDetails en 2.0 (CONSULTAS.md §1.4). Referencias 1.x:
// `steamAppId.test.ts` (override del appid) y los casos del alta de
// `plan.test.ts`; más los propios del 2.0 (id determinista, resucitar,
// omitir frente a null, sellos externos).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

type Row = Record<string, unknown>;
const all = (query: string, ...params: (string | number)[]): Row[] =>
  fx.local.db.$client.prepare(query).all(...params) as Row[];

const playthroughsOf = (gameId: string): Row[] =>
  all('SELECT * FROM playthroughs WHERE gameId = ? ORDER BY syncCreated, id', gameId);

const eventsOf = (gameId: string): Row[] =>
  all(
    `SELECT e.* FROM state_events e JOIN playthroughs p ON p.id = e.playthroughId
     WHERE p.gameId = ? ORDER BY e.syncCreated, e.id`,
    gameId,
  );

const DAY = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('createGameWithDetails: el reparto entre games, game_metadata y external_checks', () => {
  it('con igdbId el id es determinista; identidad a games, caché a game_metadata', () => {
    const row = createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR);
    const id = gameIdForIgdb(20001);
    assert.equal(row.id, id);
    assert.equal(row.title, 'Silksong');
    assert.equal(row.igdbId, 20001);
    assert.equal(row.planned, false);
    assert.deepEqual(row.addedAt, new Date(T0));
    assert.equal(row.promotedAt, null);
    // Efectivos: sin override, los de la caché.
    assert.equal(row.coverUrl, 'https://covers/silksong.jpg');
    assert.equal(row.developer, 'Team Cherry');
    assert.equal(row.hltbMain, 32);
    assert.equal(row.summary, 'Hornet vuelve a un reino que no la esperaba.');

    const game = rawRow(fx.local, 'games', id);
    assert.equal(game?.coverOverride, null);
    assert.equal(game?.steamAppId, 1030300);
    assert.equal(game?.steamAppIdSource, 'auto');
    assert.equal(game?.sgdbId, 5555);
    assert.equal(game?.sgdbIdSource, 'auto');
    // saveKey = igdbId tal cual (§3.4).
    assert.equal(game?.saveKey, '20001');
    const md = rawRow(fx.local, 'game_metadata', id);
    assert.equal(md?.coverUrl, 'https://covers/silksong.jpg');
    assert.equal(md?.releaseYear, 2026);
  });

  it('sin igdbId (alta desde Steam) el id es aleatorio y saveKey = id', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({ source: { steamAppId: 99 } }),
      steamEnrichment(),
      EUR,
    );
    assert.notEqual(row.id, gameIdForIgdb(20001));
    assert.equal(row.igdbId, null);
    assert.equal(row.steamAppId, 99);
    assert.equal(rawRow(fx.local, 'games', row.id)?.saveKey, row.id);
    // Una sola escritura del juego: nada de crear y luego parchear el saveKey.
    const game = rawRow(fx.local, 'games', row.id);
    assert.equal(game?.syncUpdated, game?.syncCreated);
  });

  it('la carátula elegida va a override y la automática a la caché [S]', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({ coverUrl: 'https://mia.jpg', heroUrl: null, steamGridDbId: 77 }),
      enrichment({ steamGridDbId: 77 }),
      EUR,
    );
    assert.equal(row.coverUrl, 'https://mia.jpg');
    assert.equal(row.heroUrl, 'https://heroes/silksong.jpg');
    const game = rawRow(fx.local, 'games', row.id);
    assert.equal(game?.coverOverride, 'https://mia.jpg');
    assert.equal(game?.heroOverride, null);
    assert.equal(game?.sgdbIdSource, 'manual');
    assert.equal(
      rawRow(fx.local, 'game_metadata', row.id)?.coverUrl,
      'https://covers/silksong.jpg',
    );
    // Un id tecleado no es una respuesta de SteamGridDB: sin sello.
    assert.equal(rawRow(fx.local, 'external_checks', externalCheckId(row.id, 'sgdb')), undefined);
  });

  it('omitir frente a null: lo que no consta no se escribe (H-2)', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({ gameNotes: null, hoursPlayed: null }),
      enrichment({ developer: null, hltbMain: null, steamGridDbId: null }),
      EUR,
    );
    const clocksOf = (table: string, id: string): Record<string, string> =>
      JSON.parse(String(rawRow(fx.local, table, id)?.syncFields)) as Record<string, string>;
    // Las columnas omitidas llevan reloj BOTTOM (aparecen en syncFields);
    // las escritas, el de creación (no aparecen).
    const game = clocksOf('games', row.id);
    assert.ok('notes' in game, 'notes omitida');
    assert.ok('coverOverride' in game, 'coverOverride omitida');
    assert.ok('sgdbId' in game, 'sgdbId omitida');
    assert.ok(!('title' in game));
    const md = clocksOf('game_metadata', row.id);
    assert.ok('developer' in md && 'hltbMain' in md);
    assert.ok(!('publisher' in md));
    const [pt] = playthroughsOf(row.id);
    assert.ok('manualHours' in clocksOf('playthroughs', String(pt.id)));
  });

  it('deja los sellos del alta: appid y notas siempre, hltb y sgdb solo con dato', () => {
    const row = createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR);
    const check = (source: string): Row | undefined =>
      rawRow(fx.local, 'external_checks', externalCheckId(row.id, source));
    assert.equal(check('steam_appid')?.status, 'ok');
    assert.equal(check('igdb_ratings')?.status, 'ok');
    assert.equal(check('hltb')?.status, 'ok');
    assert.equal(check('sgdb')?.status, 'ok');
    assert.deepEqual(row.steamAppIdCheckedAt, new Date(T0));

    const steam = createGameWithDetails(
      fx.ctx,
      createInput({ source: { steamAppId: 99 } }),
      steamEnrichment({ steamAppId: null, title: 'Sin appid' }),
      EUR,
    );
    const steamCheck = (source: string): Row | undefined =>
      rawRow(fx.local, 'external_checks', externalCheckId(steam.id, source));
    assert.equal(steamCheck('steam_appid')?.status, 'empty');
    assert.equal(steamCheck('igdb_ratings')?.status, 'empty');
    assert.equal(steamCheck('hltb'), undefined);
    assert.equal(steamCheck('sgdb'), undefined);
  });
});

describe('createGameWithDetails: appid de Steam (referencia steamAppId.test.ts)', () => {
  it('el appid forzado se fija como manual', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({ steamAppIdOverride: 222 }),
      enrichment({ steamAppId: 222 }),
      EUR,
    );
    assert.equal(row.steamAppId, 222);
    assert.equal(row.steamAppIdManual, true);
  });

  it('sin override se queda el detectado, automático', () => {
    const row = createGameWithDetails(fx.ctx, createInput(), enrichment({ steamAppId: 111 }), EUR);
    assert.equal(row.steamAppId, 111);
    assert.equal(row.steamAppIdManual, false);
  });

  it('planEnrichmentRequest: desde la búsqueda de Steam, el appid forzado manda en la fuente', () => {
    const request = planEnrichmentRequest(
      createInput({ source: { steamAppId: 111 }, steamAppIdOverride: 222 }),
    );
    assert.deepEqual(request.source, { steamAppId: 222 });
    assert.equal(request.overrides.steamAppIdOverride, 222);
    // Carátula y banner nunca se piden con la elección: la automática va a la caché.
    assert.equal(request.overrides.coverUrl, null);
    assert.deepEqual(
      planEnrichmentRequest(createInput({ steamAppIdOverride: 222, coverUrl: 'x' })).source,
      { igdbId: 20001 },
    );
  });

  it('un appid forzado fuera de rango se rechaza sin escribir', () => {
    assert.throws(
      () => planEnrichmentRequest(createInput({ steamAppIdOverride: 0 })),
      /Invalid Steam App ID/,
    );
    assert.throws(
      () =>
        createGameWithDetails(
          fx.ctx,
          createInput({ steamAppIdOverride: 0x100000000 }),
          enrichment(),
          EUR,
        ),
      (error) => isGameWriteError(error, 'invalid_input'),
    );
    assert.equal(count(fx.local, 'games'), 0);
  });
});

describe('createGameWithDetails: primer playthrough y papeleo', () => {
  it('crea el playthrough sin etiqueta guardada, con plataforma, origen, formato y horas', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({
        iteration: { playedPlatform: 'Nintendo Switch', origin: 'Gift', format: 'physical' },
        hoursPlayed: 12.5,
      }),
      enrichment(),
      EUR,
    );
    const pts = playthroughsOf(row.id);
    assert.equal(pts.length, 1);
    assert.equal(pts[0].customLabel, null);
    assert.equal(pts[0].playedPlatform, 'Nintendo Switch');
    assert.equal(pts[0].origin, 'Gift');
    assert.equal(pts[0].format, 'physical');
    assert.equal(pts[0].manualHours, 12.5);
  });

  it('sin estado inicial no hay eventos, y sin gasto no hay gasto', () => {
    const row = createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR);
    assert.equal(eventsOf(row.id).length, 0);
    assert.equal(count(fx.local, 'spend_events'), 0);
  });

  it('SPEC 4.5: un estado terminal con fecha de inicio estrena "started"; la nota va en el elegido', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({
        initialStatus: 'completed',
        started: { date: DAY('2026-01-05'), precision: 'day' },
        finished: { date: DAY('2026-02-10'), precision: 'month' },
        note: 'Final verdadero',
      }),
      enrichment(),
      EUR,
    );
    assert.deepEqual(
      eventsOf(row.id).map((e) => [e.type, e.occurredAt, e.datePrecision, e.note, e.deviceId]),
      [
        ['started', DAY('2026-01-05').getTime(), 'day', null, fx.ctx.deviceId],
        ['completed', DAY('2026-02-10').getTime(), 'month', 'Final verdadero', fx.ctx.deviceId],
      ],
    );
  });

  it('R-07: sin fecha real, el evento va al alta con precisión unknown (nunca una fecha inventada)', () => {
    fx.wall.advance(60_000);
    const row = createGameWithDetails(
      fx.ctx,
      createInput({ initialStatus: 'completed' }),
      enrichment(),
      EUR,
    );
    const events = eventsOf(row.id);
    assert.deepEqual(
      events.map((e) => [e.type, e.occurredAt, e.datePrecision]),
      [['completed', T0 + 60_000, 'unknown']],
    );
    assert.deepEqual(row.addedAt, at(60_000));
  });

  it('un estado no terminal ignora la fecha de fin y usa la de inicio', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({
        initialStatus: 'started',
        started: { date: DAY('2026-01-05'), precision: 'day' },
        finished: { date: DAY('2026-02-10'), precision: 'day' },
      }),
      enrichment(),
      EUR,
    );
    assert.deepEqual(
      eventsOf(row.id).map((e) => [e.type, e.occurredAt]),
      [['started', DAY('2026-01-05').getTime()]],
    );
  });

  it('el gasto inicial lleva su fecha, precisión y la moneda de la configuración; sin fecha, ahora', () => {
    const dated = createGameWithDetails(
      fx.ctx,
      createInput({
        moneySpent: 19.99,
        moneySpentDate: { date: DAY('2026-06-01'), precision: 'month' },
      }),
      enrichment(),
      { currency: 'USD' },
    );
    const [spend] = all('SELECT * FROM spend_events WHERE gameId = ?', dated.id);
    assert.deepEqual(
      [
        spend.type,
        spend.amount,
        spend.currency,
        spend.occurredAt,
        spend.datePrecision,
        spend.playthroughId,
      ],
      ['purchase', 19.99, 'USD', DAY('2026-06-01').getTime(), 'month', null],
    );

    const undated = createGameWithDetails(
      fx.ctx,
      createInput({ source: { steamAppId: 99 }, moneySpent: 5 }),
      steamEnrichment(),
      EUR,
    );
    const [other] = all('SELECT * FROM spend_events WHERE gameId = ?', undated.id);
    assert.deepEqual([other.occurredAt, other.datePrecision], [T0, 'day']);
  });

  it('plan_to_play como estado inicial se rechaza antes de escribir nada', () => {
    assert.throws(
      () =>
        createGameWithDetails(
          fx.ctx,
          createInput({ initialStatus: 'plan_to_play' }),
          enrichment(),
          EUR,
        ),
      (error) => isGameWriteError(error, 'invalid_input'),
    );
    assert.equal(count(fx.local, 'games'), 0);
  });

  it('endless, emulado, notas y la instalación de este PC', () => {
    const row = createGameWithDetails(
      fx.ctx,
      createInput({
        endless: true,
        isEmulated: true,
        gameNotes: 'Con mando',
        executablePath: 'C:\\Silksong\\silksong.exe',
        installDirectory: 'C:\\Silksong',
        installSizeBytes: 9_000,
      }),
      enrichment(),
      EUR,
    );
    assert.equal(row.endless, true);
    assert.equal(row.isEmulated, true);
    assert.equal(row.notes, 'Con mando');
    assert.equal(row.executablePath, 'C:\\Silksong\\silksong.exe');
    assert.equal(row.installSizeBytes, 9_000);
    const inst = rawRow(fx.local, 'game_installs', gameInstallId(row.id, fx.ctx.deviceId));
    assert.equal(inst?.lastVerifiedAt, T0);
  });

  it('sin rutas no se crea instalación', () => {
    createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR);
    assert.equal(count(fx.local, 'game_installs'), 0);
  });

  it('todo o nada: si falla una parte no queda ni el juego', () => {
    assert.throws(() =>
      createGameWithDetails(fx.ctx, createInput({ hoursPlayed: Number.NaN }), enrichment(), EUR),
    );
    assert.throws(() =>
      createGameWithDetails(
        fx.ctx,
        createInput({ moneySpent: 5, initialStatus: 'started' }),
        enrichment(),
        { currency: null as unknown as string },
      ),
    );
    for (const table of [
      'games',
      'game_metadata',
      'external_checks',
      'playthroughs',
      'state_events',
    ]) {
      assert.equal(count(fx.local, table), 0, table);
    }
  });
});

describe('createGameWithDetails: el mismo igdbId otra vez', () => {
  it('con el juego VIVO falla con already_exists y no toca nada', () => {
    createGameWithDetails(fx.ctx, createInput({ gameNotes: 'Mías' }), enrichment(), EUR);
    assert.equal(findLiveGameIdForIgdb(fx.ctx, 20001), gameIdForIgdb(20001));
    assert.throws(
      () => createGameWithDetails(fx.ctx, createInput(), enrichment({ title: 'Otro' }), EUR),
      (error) => isGameWriteError(error, 'already_exists'),
    );
    assert.equal(rawRow(fx.local, 'games', gameIdForIgdb(20001))?.title, 'Silksong');
    assert.equal(count(fx.local, 'playthroughs'), 1);
  });

  it('con el juego también en el Plan, igual: ya está en Afterplay', () => {
    seedGame(fx.ctx, { title: 'Silksong', igdbId: 20001, planned: true });
    assert.throws(
      () => createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR),
      (error) => isGameWriteError(error, 'already_exists'),
    );
  });

  it('un juego BORRADO resucita: vuelven notas, arte y claves manuales; sus hijos siguen borrados', () => {
    const first = createGameWithDetails(
      fx.ctx,
      createInput({
        gameNotes: 'Notas de antes',
        coverUrl: 'https://elegida.jpg',
        steamAppIdOverride: 500,
        initialStatus: 'completed',
        moneySpent: 10,
      }),
      enrichment({ steamAppId: 500 }),
      EUR,
    );
    const [oldPt] = playthroughsOf(first.id);
    fx.wall.advance(86_400_000);
    assert.equal(deleteGame(fx.ctx, first.id), true);
    assert.equal(findLiveGameIdForIgdb(fx.ctx, 20001), null);

    fx.wall.advance(86_400_000);
    const again = createGameWithDetails(
      fx.ctx,
      createInput({ gameNotes: null, coverUrl: null }),
      enrichment({ steamAppId: 777, summary: null }),
      EUR,
    );
    assert.equal(again.id, first.id);
    assert.equal(again.notes, 'Notas de antes');
    assert.equal(again.coverUrl, 'https://elegida.jpg');
    // La elección manual del appid se respeta frente al detectado (D-22).
    assert.equal(again.steamAppId, 500);
    assert.equal(again.steamAppIdManual, true);
    // Fecha de alta nueva: es un alta nueva.
    assert.deepEqual(again.addedAt, at(2 * 86_400_000));
    // La caché conservada sigue ahí aunque la red no la trajera ahora.
    assert.equal(again.summary, 'Hornet vuelve a un reino que no la esperaba.');

    const pts = playthroughsOf(first.id);
    assert.equal(pts.length, 2);
    assert.equal(pts.find((pt) => pt.id === oldPt.id)?.syncDeleted !== null, true);
    assert.equal(pts.filter((pt) => pt.syncDeleted === null).length, 1);
    assert.equal(count(fx.local, 'spend_events', 'syncDeleted IS NULL'), 0);
    assert.equal(count(fx.local, 'state_events', 'syncDeleted IS NULL'), 0);
  });

  it('al resucitar, una promoción de antes no vuelve y un appid automático sin sustituto se limpia', () => {
    const id = seedGame(fx.ctx, {
      title: 'Silksong',
      igdbId: 20001,
      promotedAt: at(5),
      steamAppId: 400,
      steamAppIdSource: 'auto',
    });
    seedSpendEvent(fx.ctx, { gameId: id });
    const pt = seedPlaythrough(fx.ctx, { gameId: id });
    seedStateEvent(fx.ctx, { playthroughId: pt });
    deleteGame(fx.ctx, id);
    const again = createGameWithDetails(
      fx.ctx,
      createInput(),
      enrichment({ steamAppId: null }),
      EUR,
    );
    assert.equal(again.promotedAt, null);
    assert.equal(again.steamAppId, null);
    assert.equal(rawRow(fx.local, 'games', id)?.steamAppIdSource, null);
  });
});
